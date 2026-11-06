import { createContext } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
interface SdkContextType {
  sdk: FatNotesPluginSDK | undefined;
}

export const SdkContext = createContext<SdkContextType>({
  sdk: undefined,
});
