import { shareUrl } from "../config.ts";

export interface SmsSender {
  sendSms(fromNumber: string, toNumber: string, message: string): Promise<void>;
}

export interface ShareLinkArgs {
  sender: SmsSender;
  from: string;
  to: string | null;
  eventId: string;
  publicBaseUrl: string;
  onError?: (err: unknown) => void;
}

export function shareMessage(eventId: string, publicBaseUrl: string): string {
  return (
    `Your plan is ready! Event ID ${eventId}: ${shareUrl(publicBaseUrl, eventId)} ` +
    "(all bookings are simulated)"
  );
}

export async function sendShareLink(args: ShareLinkArgs): Promise<boolean> {
  if (!args.to) return false;
  try {
    await args.sender.sendSms(args.from, args.to, shareMessage(args.eventId, args.publicBaseUrl));
    return true;
  } catch (err) {
    args.onError?.(err);
    return false;
  }
}
