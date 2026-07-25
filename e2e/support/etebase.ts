import process from 'node:process'
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
        + 'See e2e/README.md for how to start a server.',
        { cause: loginError },
      )
    }
  }
}

function message (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
