import type { Platform } from "@prisma/client";
import type { TeeTimeAdapter } from "./types";
import { foreupAdapter } from "./foreup";
import { chronogolfAdapter } from "./chronogolf";
import { memberSportsAdapter } from "./membersports";

const adapters: Record<Platform, TeeTimeAdapter> = {
  FOREUP: foreupAdapter,
  CHRONOGOLF: chronogolfAdapter,
  MEMBERSPORTS: memberSportsAdapter,
};

export function getAdapter(platform: Platform): TeeTimeAdapter {
  return adapters[platform];
}

export type { TeeTimeAdapter, NormalizedTeeTime } from "./types";
