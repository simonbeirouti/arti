import type {
  Capability,
  Workflow,
  Command,
} from "../../../../../packages/contracts/src/index";

export type Catalogue = {
  capabilities: Capability[];
  workflows: Workflow[];
  guides: {
    id: string;
    title: string;
    body?: string;
    audience?: string | string[];
  }[];
};

export type Dispatch = (command: Command) => Promise<boolean>;
