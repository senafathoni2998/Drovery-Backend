export interface WorkflowStep {
  id: string;
  type:
    | 'checklist'
    | 'qr_display'
    | 'qr_scan'
    | 'instruction'
    | 'drone_button'
    | 'status_check';
  title: string;
  instruction: string;
  nextLabel: string;
  items?: { id: string; label: string }[];
  hint?: string;
  icon?: string;
  iconColor?: string;
  indicator?: { label: string; color: string; description: string };
}

export interface Workflow {
  id: string;
  title: string;
  subtitle: string;
  steps: WorkflowStep[];
}

import { loadPackageWorkflow } from './load-package';
import { unloadPackageWorkflow } from './unload-package';

export const WORKFLOWS: Record<string, Workflow> = {
  [loadPackageWorkflow.id]: loadPackageWorkflow,
  [unloadPackageWorkflow.id]: unloadPackageWorkflow,
};
