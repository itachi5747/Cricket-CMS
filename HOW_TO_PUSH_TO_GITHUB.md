# 🚀 How to Push This Project to GitHub

A complete step-by-step guide to initialize Git, create a repository on GitHub, and push your Cricket CMS backend project.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Create GitHub Repository](#step-1-create-github-repository)
3. [Step 2: Initialize Git in Your Project](#step-2-initialize-git-in-your-project)
4. [Step 3: Configure Git](#step-3-configure-git)
5. [Step 4: Create .gitignore](#step-4-create-gitignore)
6. [Step 5: Stage and Commit Files](#step-5-stage-and-commit-files)
7. [Step 6: Connect to GitHub](#step-6-connect-to-github)
8. [Step 7: Push to GitHub](#step-7-push-to-github)
9. [Future Commands - Adding New Changes](#future-commands---adding-new-changes)
10. [Adding New Services Later](#adding-new-services-later)
11. [Creating Frontend Later](#creating-frontend-later)
12. [Common Git Commands Reference](#common-git-commands-reference)

---

## ✅ Prerequisites

Make sure you have:

| Tool | Check Command | Installation |
|------|---------------|--------------|
| **Git** | `git --version` | [git-scm.com](https://git-scm.com) |
| **GitHub Account** | — | [github.com](https://github.com) |

If Git is not installed:

```bash
# On Ubuntu/Debian
sudo apt update
sudo apt install git

# On macOS
brew install git

# On Windows
# Download from https://git-scm.com
```

---

## Step 1: Create GitHub Repository

### Option A: Via GitHub Website (Recommended for Beginners)

1. Go to [github.com](https://github.com) and **Sign In**
2. Click the **+** icon in the top-right → **New repository**
3. Fill in details:

   | Field | Value |
   |-------|-------|
   | **Repository name** | `cricket-cms-backend` |
   | **Description** | `Cricket Management System - Microservice Backend` |
   | **Visibility** | `Private` (or Public if you want) |
   | **Initialize with** | ☐ Add a README file |
   | | ☐ Add .gitignore |
   | | ☐ Choose a license |

4. Click **Create repository**
5. **Copy the repository URL** — it will look like:
   ```
   https://github.com/yourusername/cricket-cms-backend.git
   ```

### Option B: Via GitHub CLI

```bash
# Install GitHub CLI if not installed
# Ubuntu: sudo apt install gh
# macOS: brew install gh

# Authenticate
gh auth login

# Create repository
gh repo create cricket-cms-backend --private --source=. --description "Cricket Management System - Microservice Backend"
```

---

## Step 2: Initialize Git in Your Project

Navigate to your project directory:

```bash
cd /home/nafay/Downloads/cricket-cms-phase3/cricket-cms-backend
```

Initialize Git:

```bash
git init
```

Expected output:
```
Initialized empty Git repository in /home/nafay/Downloads/cricket-cms-phase3/cricket-cms-backend/.git/
```

---

## Step 3: Configure Git

If this is your first time using Git, configure your identity:

```bash
# Set your name (replace with your name)
git config user.name "Your Name"

# Set your email (replace with your email)
git config user.email "your.email@example.com"
```

> **Note:** This sets Git config locally for this project only. To set globally, add `--global` flag:
> ```bash
> git config --global user.name "Your Name"
> git config --global user.email "your.email@example.com"
> ```

---

## Step 4: Create .gitignore

Your project already has a `.gitignore` file. Verify it exists:

```bash
ls -la .gitignore
```

If it doesn't exist, create it:

```bash
# filepath: .gitignore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/

# Build outputs
dist/
build/
coverage/

# Environment files
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS files
.DS_Store
.idea/
.vscode/
*.swp
*.swo

# Docker volumes
postgres_data/
mongo_data/
redis_data/
rabbitmq_data/
minio_data/

# Generated
uploads/
generated/
EOF
```

---

## Step 5: Stage and Commit Files

### Stage all files:

```bash
git add .
```

### Check what's staged:

```bash
git status
```

### Commit with a message:

```bash
git commit -m "Initial commit: Cricket CMS Backend - Microservices architecture

- 9 microservices: Auth, User, Team, Match, Performance, Financial, Notification, File, Attendance
- API Gateway with rate limiting
- PostgreSQL, MongoDB, Redis, RabbitMQ, MinIO
- Docker Compose setup
- Shared library with middleware, validators, utilities
- ~60-70% complete"
```

---

## Step 6: Connect to GitHub

### Add the remote repository:

```bash
git remote add origin https://github.com/YOUR_USERNAME/cricket-cms-backend.git
```

> **Replace `YOUR_USERNAME` with your actual GitHub username!**

### Verify the remote:

```bash
git remote -v
```

Expected output:
```
origin  https://github.com/YOUR_USERNAME/cricket-cms-backend.git (fetch)
origin  https://github.com/YOUR_USERNAME/cricket-cms-backend.git (push)
```

---

## Step 7: Push to GitHub

### Push your code:

```bash
git push -u origin main
```

> **Note:** If your default branch is `master` instead of `main`, use:
> ```bash
> git push -u origin master
> ```

### If prompted for credentials:

- **Using HTTPS:** Enter your GitHub username and Personal Access Token (PAT)
- **Using SSH:** Make sure you've added your SSH key to GitHub

---

## 🎉 Congratulations!

Your project is now on GitHub! Visit:
```
https://github.com/YOUR_USERNAME/cricket-cms-backend
```

---

## 🔄 Future Commands - Adding New Changes

Whenever you make changes to your project, use these commands:

### 1. Check status (always do this first)

```bash
git status
```

### 2. Stage specific files

```bash
# Stage a specific file
git add filename.js

# Stage all changes
git add .
```

### 3. Commit with a descriptive message

```bash
git commit -m "Description of what you changed"
```

### 4. Push to GitHub

```bash
git push
```

### Full workflow example:

```bash
# 1. Check what changed
git status

# 2. Stage all changes
git add .

# 3. Commit with message
git commit -m "Fixed authentication bug in auth-service"

# 4. Push to GitHub
git push
```

---

## 🆕 Adding New Services Later

When you add new services (e.g., a new microservice) or create a frontend later:

### After creating new files/folders:

```bash
# Stage all new files
git add .

# Commit
git commit -m "Added new-service: Description of the new service"

# Push
git push
```

### Example when adding a frontend:

```bash
# After creating frontend directory
git add frontend/

git commit -m "Added React frontend application"

git push
```

---

## 📦 Adding Dependencies Later

When you install new npm packages:

```bash
# Install package
npm install package-name

# This updates package-lock.json automatically
# Stage it
git add package-lock.json

# Commit
git commit -m "Added package-name dependency"

# Push
git push
```

---

## 🔧 Common Git Commands Reference

| Command | Description |
|---------|-------------|
| `git init` | Initialize a new Git repository |
| `git clone <url>` | Clone a repository |
| `git status` | Check file status |
| `git add .` | Stage all changes |
| `git add <file>` | Stage specific file |
| `git commit -m "msg"` | Commit with message |
| `git push` | Push to remote |
| `git pull` | Pull from remote |
| `git remote -v` | View remotes |
| `git log` | View commit history |
| `git diff` | See changes |
| `git branch` | List branches |
| `git checkout -b <name>` | Create & switch branch |

---

## 🌿 Using Branches (Recommended)

### Create a new branch for features:

```bash
# Create and switch to new branch
git checkout -b feature/new-feature

# Make changes, then
git add .
git commit -m "Added new feature"

# Push branch to GitHub
git push -u origin feature/new-feature
```

### Switch back to main:

```bash
git checkout main
```

### Merge branch into main:

```bash
git checkout main
git merge feature/new-feature
git push
```

---

## ⚠️ Important Notes

1. **Never commit** `node_modules/` — it's already in `.gitignore`
2. **Never commit** `.env` files — they contain secrets
3. **Always run** `git status` before committing
4. **Use meaningful** commit messages
5. **Push regularly** to avoid losing work

---

## 📞 Troubleshooting

### "Permission denied" error?

```bash
# Use HTTPS instead of SSH
git remote set-url origin https://github.com/YOUR_USERNAME/cricket-cms-backend.git
```

### Want to change commit message?

```bash
git commit --amend -m "New message"
# Then force push (be careful!)
git push --force
```

### Accidentally committed to wrong branch?

```bash
# Move last commit to correct branch
git reset --soft HEAD~1
git stash
git checkout correct-branch
git stash pop
git add . && git commit -m "message"
```

---

## 📝 Quick Reminder Card

Copy this for quick reference:

```bash
# Daily workflow
git status          # What changed?
git add .           # Stage everything
git commit -m "msg" # Commit
git push            # Upload to GitHub

# After creating new files
git add .
git commit -m "Added new service/feature"
git push
```

---

**Your project is ready to be shared! 🎉**