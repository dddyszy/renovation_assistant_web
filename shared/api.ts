/** JSON contracts shared by the browser and API. Monetary values use integer cents. */
export type Role = "owner" | "admin" | "member" | "viewer";
export type StageStatus = "pending" | "in_progress" | "completed";

export interface ApiResponse<T, M = PaginationMeta> {
  data: T;
  meta?: M;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalCents?: number;
  paidCents?: number;
  pendingCents?: number;
}

export interface User {
  id: string;
  email: string;
  nickname: string;
  currentFamilyId?: string | null;
  currentProjectId?: string | null;
}

export interface Family {
  id: string;
  name: string;
  ownerUserId: string;
  role: Role;
  memberCount: number;
  createdAt: string;
}

export interface VersionedRecord {
  id: string;
  familyId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string;
  updatedBy: string;
}

export interface Project extends VersionedRecord {
  name: string;
  address: string;
  description: string;
  packageType: "half" | "full";
  budgetCents: number;
  startDate: string;
  endDate: string;
  status: "active" | "archived";
  templateId: string;
}

export interface Stage extends VersionedRecord {
  projectId: string;
  name: string;
  sortOrder: number;
  budgetCents: number;
  status: StageStatus;
}

export interface Material extends VersionedRecord {
  projectId: string;
  stageId: string | null;
  name: string;
  category: string;
  quantity: number | string;
  unit: string;
  model: string;
  supplier: string;
  note: string;
  totalPriceCents: number;
  purchaseStatus: "planned" | "ordered" | "purchased";
}

export interface Cost extends VersionedRecord {
  projectId: string;
  stageId: string | null;
  materialId: string | null;
  title: string;
  category: string;
  amountCents: number;
  paymentStatus: "paid" | "pending";
  merchant: string;
  paymentMethod: string;
  note: string;
  incurredAt: string;
  creatorName?: string;
}

export interface NoteColumn extends VersionedRecord {
  projectId: string;
  name: string;
  sortOrder: number;
}

export interface Note extends VersionedRecord {
  creatorName?: string;
  projectId: string;
  columnId: string;
  title: string;
  details: string[];
  starred: boolean;
  status: "pending" | "confirmed";
}

export interface SharedNote {
  title: string;
  details: string[];
  starred: boolean;
  status: "pending" | "confirmed";
  columnName: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  nickname: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
  usedBy: string | null;
  revokedAt: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  label: string;
  actorName: string;
  createdAt: string;
}

export interface Statistics {
  budgetCents: number;
  balanceCents: number;
  allocatedCents: number;
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  costCount: number;
  plannedCents: number;
  materialCount: number;
  pendingNoteCount: number;
  stages: (Stage & { actualCents: number; plannedCents: number })[];
  byCategory: { category: string; amountCents: number }[];
  byMaterial: {
    materialId: string;
    totalCents: number;
    paidCents: number;
    pendingCents: number;
  }[];
  recent: Cost[];
}

export interface ProjectResources {
  stages: Stage[];
  "note-columns": NoteColumn[];
  statistics: Statistics;
}
