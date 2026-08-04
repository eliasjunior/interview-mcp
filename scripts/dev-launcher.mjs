import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const API_HEALTH_URL = "http://127.0.0.1:3001/api/health";
const UI_URL = "http://127.0.0.1:5173";
const READINESS_TIMEOUT_MS = 20_000;
const LOG_DIR = path.join(process.cwd(), ".local", "logs");
const execFileAsync = promisify(execFile);

const services = [
  {
    label: "API 3001",
    port: 3001,
    url: API_HEALTH_URL,
    logFile: "api.log",
    command: ["npm", ["run", "dev:http"]],
    isExpectedService: isInterviewForgeApi,
  },
  {
    label: "UI 5173",
    port: 5173,
    url: UI_URL,
    logFile: "ui.log",
    command: ["npm", ["run", "dev:ui"]],
    isExpectedService: isLikelyViteUi,
  },
];

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    return {
      reachable: true,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isInterviewForgeApi(result) {
  return (
    result.reachable &&
    result.status === 200 &&
    typeof result.body === "object" &&
    result.body !== null &&
    result.body.ok === true &&
    result.body.service === "interview-forge-api"
  );
}

function isLikelyViteUi(result) {
  return (
    result.reachable &&
    result.status === 200 &&
    typeof result.body === "string" &&
    result.body.includes('<script type="module" src="/src/main.tsx">')
  );
}

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (isOpen) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

async function getPortOwner(port) {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-F",
      "pcn",
    ]);
    const owners = [];
    let current = {};

    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const prefix = line[0];
      const value = line.slice(1);

      if (prefix === "p") {
        if (current.pid) owners.push(current);
        current = { pid: value };
      } else if (prefix === "c") {
        current.command = value;
      } else if (prefix === "n") {
        current.name = value;
      }
    }

    if (current.pid) owners.push(current);
    return owners;
  } catch {
    return [];
  }
}

function formatOwners(owners) {
  if (owners.length === 0) return "owner unknown";
  return owners
    .map((owner) => {
      const command = owner.command ? `${owner.command} ` : "";
      const name = owner.name ? ` (${owner.name})` : "";
      return `${command}pid ${owner.pid}${name}`;
    })
    .join(", ");
}

function appendLogHeader(logPath, service) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(
    logPath,
    `\n\n[${new Date().toISOString()}] Starting ${service.label}: ${service.command[0]} ${service.command[1].join(" ")}\n`,
  );
}

function pipeWithLog(stream, terminalStream, logStream) {
  stream.on("data", (chunk) => {
    terminalStream.write(chunk);
    logStream.write(chunk);
  });
}

async function printStatus(service, result, isExpectedService) {
  const label = service.label;

  if (isExpectedService) {
    console.log(`${label}: running`);
    return;
  }

  if (result.reachable) {
    const owners = await getPortOwner(service.port);
    console.log(`${label}: port is occupied, but it does not look like interview-forge`);
    console.log(`  HTTP status: ${result.status}`);
    console.log(`  ${formatOwners(owners)}`);
    return;
  }

  if (await isPortOpen(service.port)) {
    const owners = await getPortOwner(service.port);
    console.log(`${label}: port is occupied, but it does not look like interview-forge`);
    console.log(`  ${formatOwners(owners)}`);
    return;
  }

  console.log(`${label}: not running`);
}

function startService(service) {
  const [command, args] = service.command;
  const logPath = path.join(LOG_DIR, service.logFile);

  console.log(`${service.label}: starting with "${command} ${args.join(" ")}"`);
  console.log(`${service.label}: logging to ${logPath}`);
  appendLogHeader(logPath, service);

  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  pipeWithLog(child.stdout, process.stdout, logStream);
  pipeWithLog(child.stderr, process.stderr, logStream);

  child.once("exit", (code, signal) => {
    logStream.end(`[${new Date().toISOString()}] ${service.label} exited (${signal ?? `code ${code}`})\n`);
    if (shuttingDown) return;
    console.error(`${service.label}: exited unexpectedly (${signal ?? `code ${code}`})`);
    process.exitCode = code ?? 1;
  });

  return child;
}

async function waitForService(service) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await fetchJson(service.url);
    if (service.isExpectedService(result)) {
      console.log(`${service.label}: ready`);
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error(`${service.label}: did not become ready within ${READINESS_TIMEOUT_MS / 1000}s`);
  return false;
}

let shuttingDown = false;
const startedChildren = [];
const serviceChecks = [];

for (const service of services) {
  const result = await fetchJson(service.url);
  const isExpectedService = service.isExpectedService(result);
  const portOpen = isExpectedService || result.reachable || await isPortOpen(service.port);

  await printStatus(service, result, isExpectedService);

  serviceChecks.push({
    service,
    isExpectedService,
    hasConflict: !isExpectedService && portOpen,
  });
}

if (serviceChecks.some((check) => check.hasConflict)) {
  process.exit(1);
}

for (const check of serviceChecks) {
  if (!check.isExpectedService) {
    startedChildren.push(startService(check.service));
  }
}

if (process.exitCode) {
  for (const child of startedChildren) {
    child.kill("SIGINT");
  }
  process.exit();
}

const readinessResults = await Promise.all(
  services.map((service) => waitForService(service))
);

if (readinessResults.some((ready) => !ready)) {
  shuttingDown = true;
  for (const child of startedChildren) {
    child.kill("SIGINT");
  }
  process.exit(1);
}

if (startedChildren.length === 0) {
  console.log("All services are already running.");
  process.exit();
}

console.log("interview-forge is ready at http://127.0.0.1:5173");
console.log("Press Ctrl-C to stop services started by this launcher.");

process.once("SIGINT", () => {
  shuttingDown = true;
  console.log("\nStopping interview-forge dev services...");
  for (const child of startedChildren) {
    child.kill("SIGINT");
  }
});
