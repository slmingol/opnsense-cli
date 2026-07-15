# Contributing to OPNsense CLI

Thank you for your interest in contributing to OPNsense CLI! This document provides guidelines for contributing to the project.

## Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages. This enables automatic semantic versioning and changelog generation.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: A new feature (triggers minor version bump)
- **fix**: A bug fix (triggers patch version bump)
- **docs**: Documentation only changes (triggers patch version bump)
- **refactor**: Code change that neither fixes a bug nor adds a feature (triggers patch version bump)
- **perf**: Performance improvement (triggers patch version bump)
- **test**: Adding or updating tests
- **build**: Changes to build system or dependencies
- **ci**: Changes to CI configuration
- **chore**: Other changes that don't modify src or test files
- **revert**: Reverts a previous commit

### Breaking Changes

To trigger a major version bump, include `BREAKING CHANGE:` in the commit footer or add `!` after the type:

```
feat!: change API endpoint structure

BREAKING CHANGE: API endpoints now use new structure
```

### Examples

```bash
# Feature (minor version bump)
git commit -m "feat(dns): add support for IPv6 addresses"

# Bug fix (patch version bump)
git commit -m "fix(haproxy): prevent duplicate frontend routes"

# Documentation (patch version bump)
git commit -m "docs: update installation instructions"

# Breaking change (major version bump)
git commit -m "feat(api)!: migrate to OPNsense 25.7 endpoint naming

BREAKING CHANGE: All DNS endpoints now use HostOverride suffix. Users must update to OPNsense 25.7 or later."

# Chore (no version bump)
git commit -m "chore: update dependencies"
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-new-feature`
3. Make your changes
4. Commit using conventional commits
5. Push to your fork
6. Create a Pull Request

## Testing

Before submitting a PR:

```bash
# Build Docker image
make build

# Test API connectivity
make test-api

# Test DNS operations
make dns-list

# Test HAProxy operations
make haproxy-list
```

## Pull Request Process

1. Update documentation if needed
2. Follow the conventional commit format
3. Ensure all tests pass
4. Wait for review and address feedback

## Release Process

Releases are automated using semantic-release:

- Commits to `main` trigger production releases
- Commits to `develop` trigger pre-releases
- Version numbers are determined by commit messages
- CHANGELOG.md is automatically updated
- GitHub releases are created automatically

Thank you for contributing!
