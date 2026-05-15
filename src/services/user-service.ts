import { UserRepository } from "../repositories/user-repository";
import type { UserProfile, UserProfilePatch } from "../types/domain";

export type UserProfileResolution = {
  user: UserProfile;
  profileChanged: boolean;
  profileReset: boolean;
};

export class UserService {
  private readonly userRepository: UserRepository;

  constructor(db: D1Database) {
    this.userRepository = new UserRepository(db);
  }

  async resolveUser(input: {
    userId?: string;
    message: string;
    forceNewUser?: boolean;
    skipProfileExtraction?: boolean;
  }): Promise<UserProfileResolution> {
    const profileReset = Boolean(input.forceNewUser);
    const userId = profileReset ? crypto.randomUUID() : input.userId ?? crypto.randomUUID();
    const user = await this.userRepository.ensureUser(userId);

    return {
      user,
      profileChanged: false,
      profileReset
    };
  }

  async updateProfile(userId: string, patch: UserProfilePatch): Promise<UserProfile> {
    return this.userRepository.update(userId, patch);
  }
}
