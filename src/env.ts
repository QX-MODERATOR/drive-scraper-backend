import dotenv from "dotenv";

dotenv.config();

export interface EnvConfig {
  port: number;
  nodeEnv: string | undefined;
}

export const env: EnvConfig = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV,
};

