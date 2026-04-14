# invoicesandexpensesbackend

Amplify Gen 2 backend for Invoices and Expenses.

## Setup

Use Node.js 20 or 22 LTS for the Amplify CLI.

```bash
yarn install
```

## Local Sandbox

```bash
yarn sandbox
```

The sandbox command writes `amplify_outputs.json` into `../invoicesandexpensesmobile` so the mobile app can configure Amplify locally.

## Deploy

```bash
yarn deploy
```

Set secrets with `npx ampx sandbox secret set <NAME>` for sandbox environments, and use AWS Parameter Store or the Amplify Console for production secrets.
# invoicesandexpensesbackend
