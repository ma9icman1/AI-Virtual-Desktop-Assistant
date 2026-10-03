import React from "react";
import { PermissionLevel } from "../../types";

interface SuperAIPermissionDialogProps {
  isOpen: boolean;
  requestedActionDescription?: string;
  onGrant: (level: PermissionLevel) => void;
  onDeny: () => void;
  assistantName?: string;
}

// Permission popup disabled for local/personal use.
// The desktop permission state and emergency-stop logic remain unchanged.
export const SuperAIPermissionDialog: React.FC<SuperAIPermissionDialogProps> = () => null;
