import { config } from "dotenv";

// Load local overrides first, then fill missing values from the shared .env file.
config({ path: [".env.local", ".env"] });
