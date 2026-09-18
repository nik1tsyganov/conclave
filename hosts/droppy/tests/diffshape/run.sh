#!/bin/zsh
# The one thing the Swift harness cannot check: the shape of the command that captures a
# builder's change. `git diff <tree>` does not see a file the builder ADDED, and most units
# add files. A live panel judged a new module from an empty diff because of it.
#
# This runs the command `BrainsRunner.captureEvidence` runs, in a throwaway repository with
# one modified file and one new one, and asserts both appear and that the repository's own
# index is left alone.
set -u
checks=0
failures=0
check() {
  checks=$((checks + 1))
  if [[ "$1" != "yes" ]]; then failures=$((failures + 1)); print -u2 "FAIL $2"; fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q .
print "a" > a.txt
git add -A
git -c user.name=t -c user.email=t@t commit -q -m one
base=$(git write-tree)
print "a2" >> a.txt
print "b" > brand-new.txt

# What the app itself put in the copy, which is not the builder's work: its evidence folder
# and any skill links staged for a seat. A live panel rejected a correct unit twice because
# these four files were in the diff beside the one file the brief allowed.
mkdir -p .droppy-brains/K1 .claude/skills
print "evidence" > .droppy-brains/K1/diff.txt
print "a skill" > .claude/skills/implement

index="$work/index"
gitx="GIT_INDEX_FILE='$index' git"
scope=". ':(exclude).droppy-brains' ':(exclude).claude/skills'"
out=$(eval "$gitx read-tree $base && $gitx add -A >/dev/null 2>&1; $gitx diff --cached $base --stat -- $scope && echo && $gitx diff --cached $base -- $scope")

[[ "$out" == *"a.txt"* ]] && check yes "a changed file is in the diff" || check no "a changed file is in the diff"
[[ "$out" == *"brand-new.txt"* ]] && check yes "a file the builder ADDED is in the diff" || check no "a file the builder ADDED is in the diff"
[[ "$out" == *"new file mode"* ]] && check yes "and is marked as a new file" || check no "and is marked as a new file"

[[ "$out" != *".droppy-brains"* ]] && check yes "the app's own evidence folder stays out of the diff" || check no "the app's own evidence folder stays out of the diff"
[[ "$out" != *".claude/skills"* ]] && check yes "and so do the skill links it staged" || check no "and so do the skill links it staged"

# The old command, kept as the thing that must stay broken: if this ever starts showing the
# new file, git changed under us and the temporary index is no longer needed.
old=$(git diff $base)
[[ "$old" != *"brand-new.txt"* ]] && check yes "plain git diff still cannot see it, which is why the index is needed" || check no "plain git diff still cannot see it"

# The copy's own index must be untouched: a checker's tree audit runs after this.
short=$(git status --short)
[[ "$short" == *"?? brand-new.txt"* ]] && check yes "the copy's index is left alone" || check no "the copy's index is left alone"

print "$((checks - failures))/$checks checks passed"
[[ $failures -eq 0 ]]
