# Voxpery Web

React + TypeScript + Vite web client for Voxpery.

## Development

Use root unified env:

```bash
cd ../..
cp .env.example .env
# set VITE_API_URL in root .env
```

Run:

```bash
npm install
npm run dev
```

Override API base URL in root `.env` with:

- `VITE_API_URL=https://api.voxpery.com` (official hosted)
- `VITE_API_URL=https://your-self-hosted.example.com` (self-hosted)
