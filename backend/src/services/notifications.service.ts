import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export async function notifyStaffMembers(data: {
  transactionId?: string;
  type: string;
  title: string;
  message: string;
}) {
  const staff = await prisma.profile.findMany({
    where: { role: { in: ['Staff', 'Admin'] } },
    select: { id: true },
  });

  const entries: {
    profileId: string;
    transactionId: string | null;
    type: string;
    title: string;
    message: string;
  }[] = [];

  for (const s of staff) {
    // Dedupe per staff member + transaction + type so we don't spam repeats.
    if (data.transactionId) {
      const existing = await prisma.notification.findFirst({
        where: { profileId: s.id, transactionId: data.transactionId, type: data.type },
      });
      if (existing) continue;
    }
    entries.push({
      profileId: s.id,
      transactionId: data.transactionId ?? null,
      type: data.type,
      title: data.title,
      message: data.message,
    });
  }

  if (entries.length) {
    await prisma.notification.createMany({ data: entries });
  }
}

export async function listNotifications(profileId: string, take = 50, type?: string) {
  return prisma.notification.findMany({
    where: { profileId, ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function markAsRead(notificationId: string, profileId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) throw new AppError(404, 'Notification not found');
  if (notification.profileId !== profileId) throw new AppError(403, 'Not your notification');

  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(profileId: string) {
  await prisma.notification.updateMany({
    where: { profileId, isRead: false },
    data: { isRead: true },
  });
}

export async function deleteNotification(notificationId: string, profileId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) throw new AppError(404, 'Notification not found');
  if (notification.profileId !== profileId) throw new AppError(403, 'Not your notification');

  await prisma.notification.delete({ where: { id: notificationId } });
}

export async function clearNotifications(profileId: string) {
  const { count } = await prisma.notification.deleteMany({ where: { profileId } });
  return count;
}

export async function getUnreadCount(profileId: string) {
  return prisma.notification.count({
    where: { profileId, isRead: false },
  });
}

export async function createNotification(data: {
  profileId: string;
  transactionId?: string;
  type: string;
  title: string;
  message: string;
}) {
  return prisma.notification.create({ data });
}
