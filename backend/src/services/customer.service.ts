import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

// Update only contact/profile fields — never item/fee columns (those stay
// "cancel + re-book"). preferences may be a string[] (converted to CSV) or
// a plain string; stored as the existing comma-joined `preferences` column.
export async function updateCustomer(
  customerId: string,
  data: { name?: string; phone?: string | null; address?: string | null; preferences?: string[] | null }
) {
  const existing = await prisma.profile.findUnique({ where: { id: customerId } });
  if (!existing) throw new AppError(404, 'Customer not found');

  const updateData: {
    name?: string;
    phone?: string | null;
    address?: string | null;
    preferences?: string | null;
  } = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.preferences !== undefined) {
    updateData.preferences = Array.isArray(data.preferences) && data.preferences.length
      ? data.preferences.join(',')
      : null;
  }

  return prisma.profile.update({
    where: { id: customerId },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true, address: true, preferences: true, role: true },
  });
}
