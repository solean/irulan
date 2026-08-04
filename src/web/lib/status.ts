import type { DeliveryRecord } from "../../shared/types";

export const getStatusBadgeVariant = (
  status: DeliveryRecord["status"] | "configured" | "missing",
): "secondary" | "outline" | "destructive" => {
  if (status === "failed" || status === "missing") return "destructive";
  if (status === "pending") return "outline";
  return "secondary";
};
