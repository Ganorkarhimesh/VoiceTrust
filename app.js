let audioCtx = null;
let micStream = null;
let sourceNode = null;
let processorNode = null;
let socket = null;

const TARGET_SAMPLE_RATE = 16000;

function setStatus(live, text) {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    if (dot) dot.classList.toggle("live", live);
    if (txt) txt.innerText = text;
}

async function startCapture() {
    document.getElementById("startBtn").disabled = true;

    // 1. First establish WebSocket connection cleanly
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${wsProtocol}://${window.location.host}/stream-audio`);
    socket.binaryType = "arraybuffer";

    socket.onopen = async () => {
        console.log("[VoxShield] WebSocket connection established.");
        setStatus(true, "streaming...");
        document.getElementById("stopBtn").disabled = false;

        // 2. Start Microphone capture ONLY AFTER WebSocket is open
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaStreamSource(micStream);

            const bufferSize = 4096;
            processorNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

            sourceNode.connect(processorNode);
            processorNode.connect(audioCtx.destination);

            processorNode.onaudioprocess = (e) => {
                // Strict ReadyState Check
                if (!socket || socket.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);
                const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
                const pcm16 = floatTo16BitPCM(downsampled);

                socket.send(pcm16);
            };
        } catch (err) {
            alert("Could not access microphone: " + err.message);
            stopCapture();
        }
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            updateDashboard(data);
            loadHistory();
        } catch (e) {
            console.error("Error parsing WS message:", e);
        }
    };

    socket.onclose = (e) => {
        console.warn("[VoxShield] Socket closed:", e.code, e.reason);
        setStatus(false, "disconnected");
        cleanupAudio();
    };

    socket.onerror = (e) => {
        console.error("[VoxShield] WebSocket error", e);
    };
}

function cleanupAudio() {
    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
}

function stopCapture() {
    cleanupAudio();
    if (socket) {
        socket.close();
        socket = null;
    }

    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = true;
    setStatus(false, "idle");
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) {
        return buffer;
    }
    const ratio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;
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

function updateDashboard(data) {
    const cVal = document.getElementById("centroidVal");
    const mVal = document.getElementById("mfccVal");
    const confVal = document.getElementById("confVal");

    if (cVal) cVal.innerText = data.centroid_mean + " Hz";
    if (mVal) mVal.innerText = data.mfcc_var;
    if (confVal) confVal.innerText = data.confidence + "%";

    const banner = document.getElementById("verdictBanner");
    if (banner) {
        banner.classList.remove("safe", "spoof");
        if (data.verdict === "SPOOF_DETECTED") {
            banner.classList.add("spoof");
            banner.innerText = "⚠ SPOOF DETECTED — Confidence " + data.confidence + "%";
        } else {
            banner.classList.add("safe");
            banner.innerText = "✓ SAFE — Confidence " + data.confidence + "%";
        }
    }
}

async function loadHistory() {
    try {
        const res = await fetch("/fetch-telemetry?limit=25");
        const json = await res.json();
        const body = document.getElementById("historyBody");
        if (!body) return;

        if (!json.logs || json.logs.length === 0) {
            body.innerHTML = '<tr><td colspan="7" style="color:#6b7280;">no records yet</td></tr>';
            return;
        }

        body.innerHTML = json.logs.map(row => {
            const verdictClass = row.verdict === "SPOOF_DETECTED" ? "verdict-spoof" : "verdict-safe";
            const timeStr = row.created_at ? new Date(row.created_at).toLocaleTimeString() : "-";
            return `<tr>
                <td>${row.id}</td>
                <td>${row.session_id}</td>
                <td>${row.spectral_centroid_mean}</td>
                <td>${row.mfcc_variance}</td>
                <td>${row.spoof_confidence}%</td>
                <td class="${verdictClass}">${row.verdict}</td>
                <td>${timeStr}</td>
            </tr>`;
        }).join("");

    } catch (err) {
        console.error("Failed to fetch telemetry", err);
    }
}

window.onload = loadHistory;
