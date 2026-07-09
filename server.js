import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { HiggsfieldClient } from '@higgsfield/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const higgsfield = new HiggsfieldClient({
  apiKey: process.env.HIGGSFIELD_API_KEY,
  apiSecret: process.env.HIGGSFIELD_API_SECRET,
});

const BLUEBOOK_SYSTEM_PROMPT = `You are "BlueBook", an investigator specialized in Unidentified Aerial Phenomena (UAP).
Your goal is to interrogate the witness to gather 4 crucial pieces of information to generate a video reconstruction of the event:
1. Exact location or environment type (forest, city, desert...)
2. Weather and lighting conditions (night, rain, fog, sunny...)
3. Shape and appearance of the object (triangle, saucer, glowing sphere...)
4. Movement or behavior of the object (hovering, blazing speed, zig-zag...)

Behavioral Rules:
- Be cold, professional, and mysterious ("Men in Black" or "X-Files" tone).
- Ask only one or two questions at a time.
- If the witness gives vague information, ask for clarifications.
- Once you have the 4 clear pieces of information, you MUST reply with a JSON block containing the parameters for Higgsfield, and NOTHING ELSE.

Expected JSON format at the end:
{
  "status": "complete",
  "higgsfield_prompt": "Cinematic shot, [weather], [location], a [shape] UFO [movement], 8k resolution, photorealistic",
  "dossier_summary": "Summary of the sighting for the final dossier."
}`;

// Best-effort extraction of a trailing JSON object from the model's reply.
function tryExtractCompletionJSON(text) {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;

  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && parsed.status === 'complete' && parsed.higgsfield_prompt) {
      return parsed;
    }
  } catch (_err) {
    // Not valid JSON — treat as an ordinary chat reply.
  }
  return null;
}

async function runCliCommand(command) {
  const { stdout } = await execAsync(command);
  return JSON.parse(stdout.trim());
}

async function generateWithCli(model, prompt, isVideo = true, resolution = '720p', sketchPath = null) {
  const aspect = isVideo ? '16:9' : '1:1';
  let extraArgs = '';
  
  if (isVideo) {
    extraArgs += ` --resolution ${resolution}`;
    if (resolution === '480p' || resolution === '720p') {
      extraArgs += ' --mode fast';
    }
  }

  // Resolve CLI binary path (local node_modules/.bin on Render / Windows, fallback to global)
  let cliPath = 'higgsfield';
  if (fs.existsSync('./node_modules/.bin/higgsfield')) {
    cliPath = './node_modules/.bin/higgsfield';
  } else if (fs.existsSync('.\\node_modules\\.bin\\higgsfield.cmd')) {
    cliPath = '.\\node_modules\\.bin\\higgsfield.cmd';
  }

  // Dynamically write credentials.json to ~/.config/higgsfield/credentials.json on Render to bypass OAuth browser login
  if (process.env.HIGGSFIELD_API_TOKEN) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/opt/render';
    const configDir = path.join(homeDir, '.config', 'higgsfield');
    const credsPath = path.join(configDir, 'credentials.json');
    
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const credsData = {
        auth_version: 2,
        access_token: process.env.HIGGSFIELD_API_TOKEN,
        refresh_token: "ZTCYNJI1ZWUTNZZMZS01ZME5LWE4ZDGTYTK0ODHHYMI1ZGVI",
        expires_at: 1999999999, // Far future expiry
        token_type: "bearer",
        scope: "profile offline_access user:org:read email"
      };
      
      fs.writeFileSync(credsPath, JSON.stringify(credsData, null, 2), 'utf8');
      console.log(`Successfully wrote CLI credentials to: ${credsPath}`);
    } catch (err) {
      console.warn('Failed to write credentials.json file:', err.message);
    }
  }

  // Ensure the correct billing workspace is set in the CLI session
  if (process.env.HIGGSFIELD_WORKSPACE_ID) {
    console.log(`Setting CLI workspace to: ${process.env.HIGGSFIELD_WORKSPACE_ID}`);
    await execAsync(`${cliPath} workspace set ${process.env.HIGGSFIELD_WORKSPACE_ID}`);
  }

  // Submit job
  let createCmd = `${cliPath} generate create ${model} --prompt "${prompt.replace(/"/g, '\\"')}" --aspect_ratio ${aspect}${extraArgs} --json`;
  if (sketchPath) {
    createCmd += ` --image-references "${sketchPath}"`;
  }
  
  console.log(`Submitting CLI job: ${createCmd}`);
  const [jobId] = await runCliCommand(createCmd);
  console.log(`CLI job submitted successfully. Job ID: ${jobId}`);
  
  // Poll job status
  const maxAttempts = 60; // 3 minutes max
  const delay = 3000; // 3 seconds
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const statusCmd = `${cliPath} generate get ${jobId} --json`;
    const job = await runCliCommand(statusCmd);
    
    console.log(`Polling CLI job ${jobId}: status is ${job.status}`);
    
    if (job.status === 'completed' || job.status === 'success') {
      return job.result_url;
    }
    if (job.status === 'failed' || job.status === 'nsfw') {
      throw new Error(`Generation failed with status: ${job.status}`);
    }
  }
  throw new Error('Generation timed out');
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, resolution, sketch } = req.body;
    
    let sketchPath = null;
    if (sketch) {
        const base64Data = sketch.replace(/^data:image\/\w+;base64,/, "");
        sketchPath = path.join(__dirname, `sketch_${Date.now()}.png`);
        fs.writeFileSync(sketchPath, base64Data, 'base64');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    let replyText;
    let parsedCompletion = null;

    try {
      const completion = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: BLUEBOOK_SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      replyText = completion.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      parsedCompletion = tryExtractCompletionJSON(replyText);
    } catch (apiError) {
      console.warn('Anthropic API failed, falling back to offline simulator:', apiError.message);
      
      // Smart offline simulator
      let location = "dark pine forest";
      let weather = "raining night";
      let shape = "massive black triangular UFO";
      let movement = "floating silently in the sky";
      
      let hasLocation = false;
      let hasWeather = false;
      let hasShape = false;
      let hasMovement = false;
      let hasDate = false;
      
      const userMessages = messages.filter(m => m.role === 'user');
      userMessages.forEach(m => {
          const text = m.content.toLowerCase();
          if (text.includes("forest") || text.includes("wood")) { location = "dark pine forest"; hasLocation = true; }
          if (text.includes("city") || text.includes("town") || text.includes("street")) { location = "neon-lit city streets"; hasLocation = true; }
          if (text.includes("desert") || text.includes("sand")) { location = "vast glowing desert"; hasLocation = true; }
          if (text.includes("ocean") || text.includes("sea") || text.includes("water")) { location = "stormy dark ocean"; hasLocation = true; }
          
          if (text.includes("night") || text.includes("dark")) { weather = "raining night"; hasWeather = true; }
          if (text.includes("sunny") || text.includes("day") || text.includes("clear")) { weather = "sunny day"; hasWeather = true; }
          if (text.includes("fog") || text.includes("mist")) { weather = "foggy mysterious evening"; hasWeather = true; }
          if (text.includes("snow") || text.includes("cold")) { weather = "snowy blizzard night"; hasWeather = true; }
          
          if (text.includes("triangle") || text.includes("triangular")) { shape = "massive black triangular UFO"; hasShape = true; }
          if (text.includes("saucer") || text.includes("disk") || text.includes("disc")) { shape = "metallic flying saucer"; hasShape = true; }
          if (text.includes("sphere") || text.includes("ball") || text.includes("orb")) { shape = "glowing plasma sphere"; hasShape = true; }
          if (text.includes("cylinder") || text.includes("cigar")) { shape = "cigar-shaped metallic mothership"; hasShape = true; }
          
          if (text.includes("hover") || text.includes("float") || text.includes("still")) { movement = "floating silently in the sky"; hasMovement = true; }
          if (text.includes("speed") || text.includes("fast") || text.includes("rapid")) { movement = "shooting across the clouds at hyper-velocity"; hasMovement = true; }
          if (text.includes("zig") || text.includes("zag") || text.includes("erratic")) { movement = "moving in sharp erratic zig-zag patterns"; hasMovement = true; }
          if (text.includes("land") || text.includes("ground")) { movement = "slowly descending to touch the ground"; hasMovement = true; }
          
          if (text.match(/\b(19\d{2}|20\d{2})\b/)) { hasDate = true; }
      });
      
      const questionCount = userMessages.length;
      const isComplete = (hasLocation && hasWeather && hasShape && hasDate) || questionCount >= 6;

      if (!isComplete) {
          let followUp = "I see. Please tell me more about the incident.";
          if (questionCount === 1) {
              followUp = "Agent BlueBook connected. Please describe the incident. Where exactly were you?";
          } else if (questionCount === 2) {
              followUp = "Understood. What were the weather and lighting conditions at that time?";
          } else if (questionCount === 3) {
              followUp = "Environment noted. Can you describe the precise shape and appearance of the anomaly?";
          } else if (questionCount === 4) {
              followUp = "Interesting. How was the object moving? Was there any sound?";
          } else if (questionCount === 5) {
              followUp = "This is a critical detail: could you specify the exact year this incident took place for our archives?";
          }
          return res.json({ type: 'message', content: followUp });
      }

      // Dynamic styling depending on historical era detected
      let year = 1990;
      let stylePrompt = "grainy 1990s VHS amateur camcorder footage, tracking artifacts, color bleed, low resolution, shaky hand-held recording, night-vision tint";
      
      const yearMatch = messages.map(m => m.content).join(" ").match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
        if (year < 1980) {
          stylePrompt = "authentic 1970s 8mm film archive, warm vintage colors, scratch marks, heavy film grain, light leaks, projector shutter flicker, amateur home movie";
        } else if (year >= 1980 && year < 2000) {
          stylePrompt = `authentic ${year} VHS home video camcorder recording, tracking glitches, color bleeding, vhs scanlines, grainy night vision, shaky cam, timestamp ${year}`;
        } else if (year >= 2000 && year < 2015) {
          stylePrompt = "early 2000s low-res digital camera recording, pixelated digital compression noise, mobile phone video style, auto-focus breathing, shaky hands";
        } else {
          stylePrompt = "modern smartphone night mode video, vertical phone recording style, auto-exposure adjustments, high-ISO sensor noise, authentic accidental capture";
        }
      }

      const combinedUserText = userMessages
        .filter(m => !m.content.includes("Hello, I want to report an incident"))
        .map(m => m.content)
        .join(' ');

      parsedCompletion = {
          status: 'complete',
          higgsfield_prompt: `Amateur eye-witness capture, ${stylePrompt}, over a ${location}, a ${shape} ${movement}, depicting: ${combinedUserText}. 4k resolution, photorealistic reconstruction, cinematic lighting`,
          dossier_summary: `The witness reports observing a ${shape} over a ${location} during a ${weather} (Dated era: ${year}). Detailed account: "${combinedUserText.substring(0, 150)}..."`
      };
    }

    if (!parsedCompletion) {
      // Still interrogating — pass the agent's question straight back.
      return res.json({ type: 'message', content: replyText });
    }

    // Interrogation complete — generate the video reconstruction and a still frame.
    const { higgsfield_prompt, dossier_summary } = parsedCompletion;

    const videoModel = process.env.HIGGSFIELD_VIDEO_MODEL || 'seedance_2_0';
    const imageModel = process.env.HIGGSFIELD_IMAGE_MODEL || 'flux_2';
    const selectedResolution = resolution || '720p';

    console.log(`Triggering video generation via CLI with model: ${videoModel} at ${selectedResolution}...`);
    const videoUrl = await generateWithCli(videoModel, higgsfield_prompt, true, selectedResolution, sketchPath);
    console.log('Video generated successfully:', videoUrl);

    console.log(`Triggering image generation via CLI with model: ${imageModel}...`);
    const imageUrl = await generateWithCli(imageModel, higgsfield_prompt, false, '720p', sketchPath);
    console.log('Image generated successfully:', imageUrl);

    // clean up sketch if needed
    if (sketchPath && fs.existsSync(sketchPath)) {
        fs.unlinkSync(sketchPath);
    }

    return res.json({
      type: 'complete',
      higgsfield_prompt,
      dossier_summary,
      video_url: videoUrl,
      image_url: imageUrl,
    });
  } catch (err) {
    console.error('[/api/chat] error:', err);
    return res.status(500).json({ error: 'Investigation server error.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PROJECT BLUE BOOK server listening on http://localhost:${PORT}`);
});
