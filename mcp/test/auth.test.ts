import { AuthError, createVerifier } from '../src/shared/auth.js';
import { check, createIssuer, finish, MCP_CLIENT_ID, TENANT_ID } from './helpers.js';

const { keys, sign } = await createIssuer();
const verify = createVerifier({
  tenantId: TENANT_ID,
  audiences: [MCP_CLIENT_ID, `api://${MCP_CLIENT_ID}`],
  requiredScope: 'Mcp.Tools',
  keys,
});

const rejects = async (authorization: string | undefined) => {
  try {
    await verify(authorization);
    return false;
  } catch (error) {
    return error instanceof AuthError;
  }
};

const good = await verify(`Bearer ${await sign({ roles: ['Outlook.Assistant'] })}`);
check(
  'valid token gives caller with oid, upn and roles',
  good.oid === 'oid-alice' &&
    good.upn === 'alice@example.com' &&
    good.roles.join() === 'Outlook.Assistant',
  good,
);
const noRoles = await verify(`Bearer ${await sign({})}`);
check('token without roles is valid with no roles', noRoles.roles.length === 0, noRoles.roles);

check('missing header rejected', await rejects(undefined));
check('non-bearer header rejected', await rejects(`Basic ${await sign({})}`));
check('garbage token rejected', await rejects('Bearer abc.def.ghi'));
check('expired token rejected', await rejects(`Bearer ${await sign({}, { expiresIn: '-5m' })}`));
check(
  'other issuer rejected',
  await rejects(
    `Bearer ${await sign({}, { issuer: 'https://login.microsoftonline.com/other/v2.0' })}`,
  ),
);
check(
  'other tenant id rejected',
  await rejects(`Bearer ${await sign({ tid: '99999999-9999-9999-9999-999999999999' })}`),
);
check('missing scope rejected', await rejects(`Bearer ${await sign({ scp: 'User.Read' })}`));
check('missing oid rejected', await rejects(`Bearer ${await sign({ oid: undefined })}`));

const other = await createIssuer();
check('token signed by another key rejected', await rejects(`Bearer ${await other.sign({})}`));

const wrongAudience = createVerifier({
  tenantId: TENANT_ID,
  audiences: ['33333333-3333-3333-3333-333333333333'],
  requiredScope: 'Mcp.Tools',
  keys,
});
let audienceRejected = false;
try {
  await wrongAudience(`Bearer ${await sign({})}`);
} catch (error) {
  audienceRejected = error instanceof AuthError;
}
check('token for another audience rejected', audienceRejected);

finish();
