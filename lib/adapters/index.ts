import type { Platform } from "@prisma/client";
import type { TeeTimeAdapter } from "./types";
import { foreupAdapter } from "./foreup";
import { chronogolfAdapter } from "./chronogolf";
import { memberSportsAdapter } from "./membersports";
import { teeItUpAdapter } from "./teeitup";

const adapters: Record<Platform, TeeTimeAdapter> = {
  FOREUP: foreupAdapter,
  CHRONOGOLF: chronogolfAdapter,
  MEMBERSPORTS: memberSportsAdapter,
  TEEITUP: teeItUpAdapter,
};

export function getAdapter(platform: Platform): TeeTimeAdapter {
  return adapters[platform];
}

export type { TeeTimeAdapter, NormalizedTeeTime } from "./types";
