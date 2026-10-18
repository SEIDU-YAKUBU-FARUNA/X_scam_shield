/**
 * One-time entity secret registration script.
 * Run via: bun run scripts/register-entity-secret.ts
 * NEVER commit this file's output to git.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registerEntitySecretCiphertext, initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey) {
    console.error('ERROR: CIRCLE_API_KEY is not set in .env')
    process.exit(1)
  }

  // Generate secret — use randomBytes so value is never printed to stdout
  const entitySecret = crypto.randomBytes(32).toString('hex')

  // Ensure recovery dir exists under /home/user/app
  const recoveryDir = '/home/user/app/.circle'
  fs.mkdirSync(recoveryDir, { recursive: true })

  console.log('Registering entity secret ciphertext with Circle...')
  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir,
  })

  // Write recovery file explicitly in case SDK didn't write it
  const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
  if (response.data?.recoveryFile) {
    fs.writeFileSync(recoveryPath, response.data.recoveryFile, 'utf-8')
  }

  // Persist secret to .env
  const envPath = '/home/user/app/.env'
  fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, 'utf-8')

  // Verify: make a read-only API call
  console.log('Verifying registration...')
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })
  await client.listWalletSets({ pageSize: 1 })

  console.log('SUCCESS: Entity secret registered and verified.')
  console.log(`Recovery file written to: ${recoveryPath}`)
  console.log('CIRCLE_ENTITY_SECRET appended to .env')
  console.log('')
  console.log('ACTION REQUIRED: Back up BOTH artifacts now:')
  console.log('  1. The CIRCLE_ENTITY_SECRET value from .env')
  console.log('  2. The recovery file at .circle/recovery_file.dat')
}

main().catch((err) => {
  console.error('Registration failed:', (err as Error)?.message ?? err)
  process.exit(1)
})
