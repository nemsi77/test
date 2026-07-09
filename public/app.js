document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const dossierContent = document.getElementById('dossier-content');
    let messages = [];
    let currentSketchBase64 = null;

    function appendMessage(role, content, isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}-msg`;
        if (isHtml) {
            msgDiv.innerHTML = content;
        } else {
            msgDiv.textContent = content;
        }
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text) return;

        appendMessage('user', text);
        userInput.value = '';
        userInput.disabled = true;
        sendBtn.disabled = true;

        messages.push({ role: 'user', content: text });

        const resolution = document.getElementById('resolution-select').value;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, resolution, sketch: currentSketchBase64 })
            });
            const data = await response.json();

            if (data.type === 'message') {
                appendMessage('agent', data.content);
                messages.push({ role: 'assistant', content: data.content });
            } else if (data.type === 'complete') {
                appendMessage('agent', `> SATELLITE LINK ESTABLISHED...<br>> CROSS-REFERENCING RADAR ANOMALIES...<br>> 2 UNREGISTERED FLIGHTS DETECTED.<br><div class="osint-radar-container"><div class="radar"></div><div class="osint-text">TARGET ACQUIRED<br>LAT: 49°51'21"N LON: 5°09'34"E<br>CORROBORATING EVIDENCE...</div></div>`, true);
                showEvidence(data);
                messages = []; // Reset for new session
                currentSketchBase64 = null;
            }
        } catch (error) {
            console.error(error);
            appendMessage('system', '> ERROR: CONNECTION TO CLASSIFIED SERVER FAILED.');
        } finally {
            userInput.disabled = false;
            sendBtn.disabled = false;
            userInput.focus();
        }
    }

    function showEvidence(data) {
        dossierContent.innerHTML = `
            <div class="evidence-container">
                <div class="summary-box">
                    <strong>OFFICIAL SUMMARY:</strong><br>
                    ${data.dossier_summary}<br><br>
                    <span style="color:var(--text-dim)">HIGGSFIELD PROMPT:</span><br>
                    <em>${data.higgsfield_prompt}</em>
                </div>

                <div class="actions-bar">
                    <a href="${data.video_url}" download="reconstruction_video.mp4" target="_blank">
                        <button class="download-btn">[ DOWNLOAD VIDEO ]</button>
                    </a>
                    <a href="${data.image_url}" download="evidence_frame.png" target="_blank">
                        <button class="download-btn">[ EXPORT IMAGE ]</button>
                    </a>
                </div>

                <div class="evidence-item">
                    <span class="evidence-label">VISUAL EVIDENCE 01 - VIDEO RECONSTRUCTION (HIGGSFIELD)</span>
                    <video src="${data.video_url}" autoplay loop muted controls></video>
                </div>

                <div class="evidence-item">
                    <span class="evidence-label">VISUAL EVIDENCE 02 - STILL FRAME</span>
                    <img src="${data.image_url}" alt="UFO Evidence">
                </div>
            </div>
        `;
    }

    sendBtn.addEventListener('click', sendMessage);

    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 150) {
            this.style.overflowY = 'auto';
            this.style.height = '150px';
        } else {
            this.style.overflowY = 'hidden';
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    const pdfUpload = document.getElementById('pdf-upload');
    pdfUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || file.type !== 'application/pdf') return;

        userInput.value = "Analyzing classified PDF...";
        userInput.disabled = true;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(" ");
                fullText += pageText + "\n";
            }
            userInput.value = fullText.trim();
            userInput.dispatchEvent(new Event('input'));
        } catch (error) {
            console.error(error);
            userInput.value = "ERROR: Unable to read PDF file.";
        } finally {
            userInput.disabled = false;
            e.target.value = '';
        }
    });

    const sketchUpload = document.getElementById('sketch-upload');
    sketchUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            currentSketchBase64 = event.target.result;
            appendMessage('system', '> VISUAL REFERENCE ACQUIRED (SKETCH LOADED).');
        };
        reader.readAsDataURL(file);
    });

    function startInitialChat() {
        setTimeout(async () => {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: "Hello, I want to report an incident." }], resolution: document.getElementById('resolution-select').value, sketch: currentSketchBase64 })
            });
            const data = await response.json();
            appendMessage('agent', data.content);
            messages.push({ role: 'user', content: "Hello, I want to report an incident." });
            messages.push({ role: 'assistant', content: data.content });
        }, 500);
    }

    const introScreen = document.getElementById('intro-screen');
    const introVideo = document.getElementById('intro-video');

    function hideIntro() {
        if (!introScreen.classList.contains('intro-hidden')) {
            introScreen.classList.add('intro-hidden');
            setTimeout(() => introScreen.style.display = 'none', 1000);
            startInitialChat();
        }
    }

    if (introVideo) {
        introVideo.addEventListener('ended', hideIntro);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !introScreen.classList.contains('intro-hidden')) {
                hideIntro();
            }
        });
        introScreen.addEventListener('click', hideIntro);
    } else {
        startInitialChat();
    }
});
