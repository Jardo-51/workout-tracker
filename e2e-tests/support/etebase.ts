import process from 'node:process'
import { test } from '@playwright/test'
import * as Etebase from 'etebase'

/**
 * The Etesync server the sync tests run against. Nothing here talks to the
 * app — it only makes sure the account the browsers are about to log in to
 * exists, which is the one thing they cannot do for themselves.
 */
export interface Account {
  url: string
  username: string
  password: string
}

/**
 * Reads the account out of the environment, or returns undefined so the sync
 * tests can skip rather than fail on a machine without a server.
 */
export function accountFromEnv (): Account | undefined {
  const url = process.env.E2E_ETEBASE_URL
  if (!url) {
    return undefined
  }
  return {
    url,
    username: process.env.E2E_ETEBASE_USERNAME ?? 'gymrat',
    password: process.env.E2E_ETEBASE_PASSWORD ?? 'correct-horse-battery',
  }
}

/**
 * Signs the account up, or confirms it is already usable.
 *
 * Servers differ on whether signup is open — the docker image in the README
 * seeds one user and refuses the rest — so a failed signup is only a problem
 * if the login that follows it fails too.
 */
export async function ensureAccount (account: Account): Promise<void> {
  const { url, username, password } = account
  try {
    const created = await Etebase.Account.signup(
      { username, email: `${username}@example.com` },
      password,
      url,
    )
    await created.logout()
    return
  } catch (signupError) {
    try {
      const existing = await Etebase.Account.login(username, password, url)
      await existing.logout()
    } catch (loginError) {
      throw new Error(
        `Could not sign up or log in as "${username}" at ${url}.\n`
        + `  signup: ${message(signupError)}\n`
        + `  login:  ${message(loginError)}\n`
        + 'See e2e-tests/README.md for how to start a server.',
        { cause: loginError },
      )
    }
  }
}

function message (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `test.describe` every spec that needs the server wants: skipped whole
 * when none is configured, serial because they all share one long-lived
 * account, and that account signed up once before any test in the block runs.
 *
 * The body is handed the account already narrowed, which is what spares each
 * test inside a `account!` on every use. A describe-level `test.skip` cannot
 * narrow anything — it decides at run time, while the tests are registered
 * either way — so the cast below is where that is admitted: once, next to the
 * skip that is the reason nothing inside ever sees the undefined.
 */
export function syncedDescribe (title: string, body: (account: Account) => void) {
  const account = accountFromEnv() as Account
  test.describe(title, () => {
    test.skip(!account, 'set E2E_ETEBASE_URL to run the sync tests — see e2e-tests/README.md')
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async () => {
      await ensureAccount(account)
    })

    body(account)
  })
}
