import type { UserProfile } from "../types/domain";

const resetProfilePatterns = [
  /重新开始/u,
  /重置(我的)?资料/u,
  /清除(我的)?资料/u,
  /清空(我的)?资料/u,
  /切换用户/u,
  /我是另一个用户/u,
  /换个用户/u,
  /重新注册/u,
  /forget me/i,
  /reset (my )?profile/i,
  /start over/i,
  /switch user/i
];

export function isProfileResetIntent(message: string): boolean {
  return resetProfilePatterns.some((pattern) => pattern.test(message));
}

export function createProfileUpdatedPrefix(user: UserProfile): string {
  const namePart = user.name ? `${user.name}，` : "";
  return `${namePart}我已更新你的资料。`;
}
