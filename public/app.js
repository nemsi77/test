document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const dossierContent = document.getElementById('dossier-content');
    let messages = [];

    function appendMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'agent-msg'}`;
        msgDiv.textContent = content;
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
                body: JSON.stringify({ messages, resolution })
            });
            const data = await response.json();

            if (data.type === 'complete') {
                appendMessage('agent', "DATA ACQUIRED. RECONSTRUCTION IN PROGRESS...");
                showEvidence(data);
            } else {
                appendMessage('agent', data.content);
                messages.push({ role: 'assistant', content: data.content });
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

                <div class="evidence-item">
                    <span class="evidence-label">VISUAL EVIDENCE 01 - VIDEO RECONSTRUCTION (HIGGSFIELD)</span>
                    <video src="${data.video_url}" autoplay loop muted controls></video>
                </div>

                <div class="evidence-item">
                    <span class="evidence-label">VISUAL EVIDENCE 02 - STILL FRAME</span>
                    <img src="${data.image_url}" alt="UFO Evidence">
                </div>

                <div class="actions-bar">
                    <a href="${data.video_url}" download="reconstruction_video.mp4" target="_blank">
                        <button class="download-btn">[ DOWNLOAD VIDEO ]</button>
                    </a>
                    <a href="${data.image_url}" download="evidence_frame.png" target="_blank">
                        <button class="download-btn">[ EXPORT IMAGE ]</button>
                    </a>
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

    setTimeout(async () => {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: "Hello, I want to report an incident." }] })
        });
        const data = await response.json();
        appendMessage('agent', data.content);
        messages.push({ role: 'user', content: "Hello, I want to report an incident." });
        messages.push({ role: 'assistant', content: data.content });
    }, 1500);
});
