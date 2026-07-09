# 🛸 Project Blue Book: UAP Testimony Transcription Engine

**Project Blue Book** is an immersive, 1980s retro-terminal web application designed for the official transcription of Unidentified Anomalous Phenomena (UAP) testimonies. 
Built for referencing agencies like GEIPAN and AARO, this tool takes witness accounts and hand-drawn sketches, and transforms them into highly precise, photorealistic video evidence using the **Higgsfield AI** engine.

## ✨ Features

- **📺 Immersive Retro UI:** A fully responsive, full-screen CRT monitor experience complete with scanlines, phosphor glow, flicker effects, and a cinematic video boot-up sequence.
- **🕵️‍♂️ Interactive AI Agent:** An automated interrogation protocol that dynamically extracts missing key details (Year, Location, Weather, Shape, Movement) from the witness.
- **📡 OSINT Radar Integration:** Real-time visual feedback with a simulated satellite radar sweep and anomaly cross-referencing directly in the chat interface.
- **🖼️ Sketch-to-Video:** Users can upload their own sketches or photos as visual references. The app utilizes Higgsfield's Image-to-Video capabilities to perfectly reconstruct the anomaly's shape.
- **📄 Evidence Export:** Download the generated video and high-resolution still frames directly from the dossier.

## 🚀 How it uses Higgsfield AI

This project heavily leverages the **Higgsfield CLI** to process multimodal inputs:
- **Text-to-Video:** The witness testimony is compiled into a highly detailed prompt targeting authentic VHS or 35mm film aesthetics, and sent to the `seedance_2_0` model.
- **Image-to-Video:** When a witness uploads a sketch, the backend passes the file via the `--image-references` flag to ensure the generated craft strictly adheres to the witness's memory.

## 🛠️ Tech Stack
- **Frontend:** Vanilla HTML, CSS, JavaScript (Custom CSS for retro CRT rendering).
- **Backend:** Node.js, Express.
- **AI Engine:** Higgsfield CLI (`seedance_2_0` & `photon_1`).

## 📥 Installation & Local Dev

```bash
# Clone the repository
git clone https://github.com/nemsi77/test.git
cd test

# Install dependencies
npm install

# Run the server
npm start
```
*The server will be available at `http://localhost:10000`.*
