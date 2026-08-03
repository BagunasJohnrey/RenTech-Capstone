# RenTech Development Setup

## Concurrent Development Environment

This project now includes a concurrent development setup that runs both the frontend and backend simultaneously with automatic restarts when files change.

### Running the Development Environment

To start both frontend and backend with live reload:

```bash
npm run dev
```

This command will:
- Start the backend server (Node.js/Express) on port 3001
- Start the frontend development server (Vite) on port 5174
- Automatically restart the backend when files in `backend/src` change
- Automatically reload the frontend when files in `frontend/src` change

### Individual Commands

If you want to run only one part of the application:

```bash
# Run only the backend
npm run dev:backend

# Run only the frontend
npm run dev:frontend
```

### How It Works

- **concurrently**: Runs both processes in parallel with labeled output
- **nodemon**: Watches for file changes in the backend and restarts automatically
- **Vite**: Provides hot module replacement for the frontend

### Ports

- Frontend: http://localhost:5174
- Backend: http://localhost:3001

If port 5174 is in use, Vite will automatically select the next available port.

### File Watching

- Backend watches all files in `backend/src` directory
- Frontend watches all files in `frontend/src` directory
- Changes to configuration files may require a manual restart

## Production Deployment (auto-restart / crash recovery)

Dev uses `npm run dev` + `tsx watch` (see above). In **production** the backend runs under **pm2** so it restarts automatically if it crashes:

```bash
cd backend
npm run build          # tsc -> dist/
npm run pm2:start      # pm2 start ecosystem.config.cjs (or: pm2 start ecosystem.config.cjs)
pm2 save               # persist the process list
pm2 startup            # auto-start pm2 on host boot (prints a command to run)
```

- `backend/ecosystem.config.cjs` runs `dist/index.js` in production with `restart_delay: 1000` and `max_restarts: 5`.
- The host/load-balancer health check should point at `GET /api/health` (already implemented).
- Production HTTPS: `index.ts` redirects http→https (except `/api/health`) and sets HSTS via helmet, so the host must terminate TLS and set `NODE_ENV=production`.
- Do not run pm2 for local development — keep using `npm run dev` with `tsx watch`.