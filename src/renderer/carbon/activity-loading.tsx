import { Loading } from "@carbon/react";

/** The adjacent status text supplies the accessible description. */
export function ActivityLoading() {
  return <Loading small withOverlay={false} aria-hidden="true" className="chat-loading" />;
}
