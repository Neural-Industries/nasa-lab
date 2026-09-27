// Vercel serverless entry. vercel.json rewrites every /api/* request here, and
// Express routes it by the original path. The NASA key is read from the
// NASA_API_KEY environment variable set in the Vercel project settings.
import { app } from '../server/app.js';

export default app;
