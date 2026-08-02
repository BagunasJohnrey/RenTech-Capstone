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