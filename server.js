import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { HiggsfieldClient } from '@higgsfield/client';
import { exec } from 'child_process';
import { promisify } from 'util';

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

async function generateWithCli(model, prompt, isVideo = true) {
  const aspect = isVideo ? '16:9' : '1:1';
  
  // Submit job
  const createCmd = `higgsfield generate create ${model} --prompt "${prompt.replace(/"/g, '\\"')}" --aspect_ratio ${aspect} --json`;
  console.log(`Submitting CLI job: ${createCmd}`);
  const [jobId] = await runCliCommand(createCmd);
  console.log(`CLI job submitted successfully. Job ID: ${jobId}`);
  
  // Poll job status
  const maxAttempts = 60; // 3 minutes max
  const delay = 3000; // 3 seconds
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const statusCmd = `higgsfield generate get ${jobId} --json`;
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
    const { messages } = req.body;
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
      });
      
      const questionCount = userMessages.length;
      const isComplete = (hasLocation && hasWeather && hasShape) || questionCount >= 5;

      if (!isComplete) {
          let followUp = "I see. Please tell me more about the incident.";
          if (questionCount === 1) {
              followUp = "Agent BlueBook connected. Please describe the incident. Where exactly were you?";
          } else if (!hasLocation) {
              followUp = "Understood. Where did this sighting take place? What was the surrounding environment?";
          } else if (!hasWeather) {
              followUp = "I see. What were the weather and lighting conditions at that time?";
          } else if (!hasShape) {
              followUp = "Environment noted. Can you describe the precise shape and appearance of the anomaly?";
          } else if (!hasMovement) {
              followUp = "Interesting. How was the object moving? Was there any sound?";
          }
          return res.json({ type: 'message', content: followUp });
      }

      parsedCompletion = {
          status: 'complete',
          higgsfield_prompt: `Cinematic night shot, ${weather}, over a ${location}, a ${shape} ${movement}, searchlight beams, 8k, photorealistic, vhs glitch style`,
          dossier_summary: `The witness reports observing a ${shape} over a ${location} during a ${weather}.`
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

    console.log(`Triggering video generation via CLI with model: ${videoModel}...`);
    const videoUrl = await generateWithCli(videoModel, higgsfield_prompt, true);
    console.log('Video generated successfully:', videoUrl);

    console.log(`Triggering image generation via CLI with model: ${imageModel}...`);
    const imageUrl = await generateWithCli(imageModel, higgsfield_prompt, false);
    console.log('Image generated successfully:', imageUrl);

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
