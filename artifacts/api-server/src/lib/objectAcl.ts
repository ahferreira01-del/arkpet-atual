import { File } from "@google-cloud/storage";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {
  /**
   * Any active user who belongs to the creche identified by the group id.
   * This includes roles: master_admin, creche_admin, staff, and tutor.
   * The group id is the numeric crecheId serialised as a string.
   *
   * Used so that all staff/admins of a creche can read pet photos even if
   * they did not personally upload the file and even if the original uploader
   * later changes role or is removed.
   */
  CRECHE_MEMBER = "CRECHE_MEMBER",
}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as object custom metadata under "custom:aclPolicy" (JSON string).
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

/**
 * Grants access to any active user whose crecheId matches the group id.
 * The group id is the numeric crecheId serialised as a string.
 *
 * This ensures that creche admins and staff can read files (e.g. pet photos)
 * even after the original uploader changes role or leaves the creche.
 */
class CrecheMemberAccessGroup extends BaseObjectAccessGroup {
  constructor(crecheId: string) {
    super(ObjectAccessGroupType.CRECHE_MEMBER, crecheId);
  }

  public async hasMember(userId: string): Promise<boolean> {
    const numericUserId = parseInt(userId, 10);
    const numericCrecheId = parseInt(this.id, 10);
    if (isNaN(numericUserId) || isNaN(numericCrecheId)) {
      return false;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, numericUserId),
          eq(usersTable.crecheId, numericCrecheId),
          eq(usersTable.isActive, true),
        ),
      )
      .limit(1);

    return !!user;
  }
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    case ObjectAccessGroupType.CRECHE_MEMBER:
      return new CrecheMemberAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
