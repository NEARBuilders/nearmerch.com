import { z } from 'every-plugin/zod';

export const ManualProviderSettingsSchema = z.object({
  notificationEmails: z.array(z.string().email()).default([]),
  ownerAccountIds: z.array(z.string()).default([]),
  replyToEmail: z.string().email().optional(),
});

export type ManualProviderSettings = z.infer<typeof ManualProviderSettingsSchema>;