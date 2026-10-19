import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type Permission, type Principal } from "./rbac";

const PUBLIC = "auth:public";
const REQUIRES = "auth:requires";
const AUTHENTICATED = "auth:authenticated";

/** Open to anyone (e.g. /health). Must be stated explicitly. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC, true);

/** Any logged-in principal, whatever their role (e.g. /me, logout). */
export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED, true);

/** The permission a route needs. */
export const Requires = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES, permission);

/**
 * Deny by default (CLAUDE.md §7): a route with none of @Public(),
 * @Authenticated() or @Requires(...) is refused, so forgetting a rule closes a route, never opens it.
 * The principal is read from `request.principal`, set only by the login layer.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRES, targets);
    const anyUser = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED, targets);
    if (!permission && !anyUser) throw new ForbiddenException("route has no access rule");

    const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    if (!principal) throw new UnauthorizedException();
    if (!permission) return true;
    if (!can(principal, permission)) throw new ForbiddenException();
    return true;
  }
}
