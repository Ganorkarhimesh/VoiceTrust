// app.js - VoxShield Real-Time Voice Clone Detection (SIH26104)

let audioCtx = null;
let micStream = null;
let sourceNode = null;
let processorNode = null;
let socket = null;

const TARGET_SAMPLE_RATE = 16000;

// UI Status Updater
function setStatus(live, text) {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    if (dot) dot.classList.toggle("live", live);
    if (txt) txt.innerText = text;
}

// Start Audio Capture & WebSocket Stream
async function startCapture() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (startBtn) startBtn.disabled = true;

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${wsProtocol}://${window.location.host}/stream-audio`);
    socket.binaryType = "arraybuffer";

    socket.onopen = async () => {
        console.log("[VoxShield] WebSocket Connected");
        setStatus(true, "streaming...");
        if (stopBtn) stopBtn.disabled = false;

        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaStreamSource(micStream);

            const bufferSize = 4096;
            processorNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

            sourceNode.connect(processorNode);
            processorNode.connect(audioCtx.destination);

            processorNode.onaudioprocess = (e) => {
                if (!socket || socket.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);
                const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
                const pcm16 = floatTo16BitPCM(downsampled);

                socket.send(pcm16);
            };
        } catch (err) {
            alert("Microphone Access Error: " + err.message);
            stopCapture();
        }
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        } catch (e) {
            console.error("[VoxShield] JSON Parse Error:", e);
        }
    };

    socket.onclose = (e) => {
        console.warn("[VoxShield] Socket closed:", e.code);
        setStatus(false, "disconnected");
        cleanupAudio();
        // Stream band hote hi latest logs load kar lo
        loadHistory();
    };

    socket.onerror = (e) => {
        console.error("[VoxShield] WebSocket Error:", e);
    };
}

function cleanupAudio() {
    if (processorNode) { processorNode.disconnect(); processorNode = null; }
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

function stopCapture() {
    cleanupAudio();
    if (socket) { socket.close(); socket = null; }
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    setStatus(false, "idle");
    loadHistory();
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) return buffer;
    const ratio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

function floatTo16BitPCM(floatSamples) {
    const buffer = new ArrayBuffer(floatSamples.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < floatSamples.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, floatSamples[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true);
    }
    return buffer;
}

// Update Real-Time Dashboard Cards ONLY (Lightweight & Instant)
function updateDashboard(data) {
    if (document.getElementById("centroidVal")) {
        document.getElementById("centroidVal").innerText = (data.centroid_mean || '--') + " Hz";
    }
    if (document.getElementById("mfccVal")) {
        document.getElementById("mfccVal").innerText = data.mfcc_var || '--';
    }
    if (document.getElementById("confVal")) {
        document.getElementById("confVal").innerText = (data.confidence || '--') + "%";
    }

    const banner = document.getElementById("verdictBanner");
    if (banner) {
        banner.classList.remove("safe", "spoof");
        const confText = data.confidence || 0;
        if (data.verdict === "SPOOF_DETECTED") {
            banner.classList.add("spoof");
            banner.innerText = "⚠ SPOOF DETECTED — Confidence " + confText + "%";
        } else {
            banner.classList.add("safe");
            banner.innerText = "✓ SAFE — Confidence " + confText + "%";
        }
    }
}

// Fetch & Render Threat History Ledger Table
async function loadHistory() {
    try {
        const res = await fetch('/fetch-telemetry?limit=25');
        if (!res.ok) return;
        const data = await res.json();

        const tbody = document.getElementById("historyBody") || 
                      document.getElementById("telemetryBody") || 
                      document.querySelector("table tbody");

        if (!tbody) return;

        const logsArray = Array.isArray(data) ? data : (data.logs || []);

        if (logsArray.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="color:#6b7280; text-align:center;">no records loaded yet</td></tr>`;
            return;
        }

        tbody.innerHTML = "";
        logsArray.forEach((log) => {
            const id = log.id || '--';
            const session = log.session_id || 'stream';
            
            const centroid = log.spectral_centroid_mean ?? log.centroid_mean ?? '--';
            const mfcc = log.mfcc_variance ?? log.mfcc_var ?? '--';
            const conf = log.spoof_confidence ?? log.confidence ?? '--';
            const verdict = log.verdict || 'UNKNOWN';
            
            const created = log.created_at;
            const timeVal = created ? new Date(created).toLocaleTimeString() : new Date().toLocaleTimeString();

            const isSpoof = verdict === "SPOOF_DETECTED";
            
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>#${id}</td>
                <td><code>${session}</code></td>
                <td>${centroid} Hz</td>
                <td>${mfcc}</td>
                <td>${conf}%</td>
                <td style="color: ${isSpoof ? '#ef4444' : '#10b981'}; font-weight: 600;">
                    ${verdict}
                </td>
                <td>${timeVal}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error("[VoxShield] Error loading history:", err);
    }
}

// Initial Load Handler
document.addEventListener("DOMContentLoaded", () => {
    loadHistory();
});
