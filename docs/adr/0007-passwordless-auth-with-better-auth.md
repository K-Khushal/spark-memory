# Passwordless auth with Better Auth on our own database

Users sign in with Google, GitHub or an emailed one-time code. Better Auth runs inside the Worker and stores sessions in Postgres, with first-party support for the browser extension and Expo. There are no passwords, because password hashing exceeds the Workers free plan's 10 ms CPU limit, and passwordless sign-in removes a whole class of support work.
