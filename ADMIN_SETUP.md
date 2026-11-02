# Admin account setup

Create the first admin account from the project directory:

```text
npm run create:admin
```

The command asks for a name and email and accepts the password without echoing it in the terminal. It requires a 12-character minimum password, stores only a bcrypt hash, and sets `isAdmin: true` only on this account. If the email is already an admin, it makes no changes; if it belongs to a customer, the command stops without modifying that account. Customer registration and Google sign-in always create accounts with `isAdmin: false`.

Sign in at `/admin/login`. Admin access is checked against the database, the session ID is regenerated after login, and protected admin requests re-check that the account still has the admin role. Customer login remains at `/login`.

Admin credentials are not stored in source files or `.env`. For deployments, provide `SESSION_SECRET` through the hosting platform's secret manager and serve the application over HTTPS. Local development generates a random session secret at startup, so restarting the app logs out existing sessions.
