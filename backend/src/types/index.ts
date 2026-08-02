import { Request } from 'express';

export enum Role {
  Admin = 'Admin',
  Staff = 'Staff',
  Customer = 'Customer',
}

export enum ItemStatus {
  Available = 'Available',
  Rented = 'Rented',
  Reserved = 'Reserved',
  Cleaning = 'Cleaning',
  Damaged = 'Damaged',
  Maintenance = 'Maintenance',
  Deleted = 'Deleted',
}

export enum TransactionStatus {
  Active = 'Active',
  Overdue = 'Overdue',
  Returned = 'Returned',
  Cancelled = 'Cancelled',
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  phone?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
