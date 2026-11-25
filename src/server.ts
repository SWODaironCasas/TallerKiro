import app from './app.js';

const DEFAULT_PORT = 3000;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/** Parses PORT and fails before opening a socket when the value is invalid. */
export function parsePort(value: string | undefined): number {
  const rawValue = value ?? String(DEFAULT_PORT);
  const normalizedValue = rawValue.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(
      `Invalid PORT "${rawValue}". PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }

  const port = Number.parseInt(normalizedValue, 10);
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `Invalid PORT "${rawValue}". PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }

  return port;
}

const port = parsePort(process.env.PORT);

app.listen(port, () => {
  console.log(`TicketOps API listening on port ${port}`);
});
