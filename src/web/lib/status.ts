import type { DeliveryRecord } from "../../shared/types";
import type { PillTone } from "../components/pill";

export const DELIVERY_STATUS_PILLS: Record<
  DeliveryRecord["status"],
  { label: string; tone: PillTone }
> = {
  pending: { label: "Pending", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};
