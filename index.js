const {Octokit} = require('@octokit/rest')
const octokit = new Octokit({ auth: process.env.TOKEN });

const bopOverhead = 50;

async function unboop({ owner, repo, pull_number, preboop }, reason) {
	console.log(`unbooping https://github.com/${owner}/${repo}/pull/${pull_number} : ${reason}`)
	const issue_number = pull_number;
	await octokit.issues.removeLabel({
		owner,
		repo,
		issue_number,
		name: 'boop',
	});

	if (preboop) {
		await octokit.issues.addLabels({
			owner,
			repo,
			issue_number,
			labels: ['preboop'],
		})

		if (reason) {
			await octokit.issues.createComment({
				owner,
				repo,
				issue_number,
				body: `prebooping: ${reason}`
			})
		}
	} else {
		await octokit.issues.createComment({
			owner,
			repo,
			issue_number,
			body: `unbooping: ${reason}`,
		})
	}
}

async function warn({ owner, repo, issue_number, labels }, warning, message) {
	if (labels.find(l => l.name === warning)) {
		return;
	}

	console.log(`warning https://github.com/${owner}/${repo}/pull/${issue_number} : ${message}`)

	await octokit.issues.addLabels({
		owner,
		repo,
		issue_number,
		labels: [warning],
	});
	await octokit.issues.createComment({
		owner,
		repo,
		issue_number,
		body: message,
	})
}

// try to encourage easy to review PRs. A negative mental overhead should lead to rejection.
// currently we'll allow a diff with 300 "meaningful" additions.
function mentalOverhead(diff) {
	const lines = diff.split('\n');

	let newName = '';
	let n = 0;
	for (const line of lines) {
		if (line.startsWith('+++ ')) {
			newName = line.slice(4);
			continue;
		}

		// ignore test files (__test__/*, *_test.go)
		if (newName.match(/__tests__|_test.go/)) continue;

		// ignore generated files (__generated__/*)
		if (newName.match(/__generated__/)) continue;

		// only added lines
		if (line[0] !== '+') continue;

		// ignore blank lines
		if (line.length === 1) continue;

		// ignore `//` style comments
		if (line.match(/\/\//)) continue;

		//console.log(line)

		n++;
	}

	return n;
}

function touchedFiles(diff) {
  const prefix = 'diff --git a/';
  return diff
    .split('\n')
    .filter(l => l.startsWith(prefix))
    .map(l => l.slice(prefix.length).split(' b/')[0])
}

function touchedDeps(diff) {
  const lockFiles = ['yarn.lock', 'go.sum'];
  return !!touchedFiles(diff)
    .map(f => f.split('/').slice(-1)[0])
    .find(n => lockFiles.includes(n))
}

function touchedNonDeps(diff) {
  const pkgFiles = ['yarn.lock', 'go.sum', 'package.json', 'go.mod'];
  return !!touchedFiles(diff)
    .map(f => f.split('/').slice(-1)[0])
    .find(n => !pkgFiles.includes(n))
}

async function boopcheck() {
	console.log('running boop check');
	const { data } = await octokit.issues.list({
		filter: 'all',
		state: 'open',
		labels: ['boop']
	});

	for (const issue of data) {
		const { number: pull_number, repository, title, body, labels } = issue;
		const repo = repository.name;
		const owner = repository.owner.login;

		const { data: pull } = await octokit.pulls.get({
			owner,
			repo,
			pull_number,
		});

		const { data: reviews } = await octokit.pulls.listReviews({
			owner,
			repo,
			pull_number,
		});

		const { data: statuses } = await octokit.repos.listCommitStatusesForRef({
			owner: pull.head.repo.owner.login,
			repo: pull.head.repo.name,
			ref: pull.head.ref,
		});


		const { data: diff } = await octokit.pulls.get({
			owner,
			repo,
			pull_number,
			mediaType: {
				format: "diff"
			}
		});

		const ctx = {
			pull_number,
			issue_number: pull_number,
			owner,
			repo,
			labels: issue.labels,
		};

		const refactor = title.toLowerCase().includes('[refactor]');
		const rfc = title.toLowerCase().includes('[rfc]');

    if (ctx.labels.find(l => l.name === 'bop') && mentalOverhead(diff) > bopOverhead) {
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: pull_number,
        name: 'bop',
      });

      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: `🚓 Looks like this PR has grown too powerful! Going to have to demote it... sorry frend`,
      });
    }


		if (rfc) {
			// seems alright to me
		} else if (!pull.mergeable && false) { // TODO(turbio): this doesn't seem reliable
			await unboop(ctx, "not mergeable");
		} else if (pull.merged) {
			await unboop(ctx, "already merged");
		} else if (statuses.length && statuses[0].state !== 'success') {
			if (statuses[0].state === 'failure' || statuses[0].state === 'error') {
				await unboop(ctx, "tests don't pass");
			} else if (statuses[0].state === 'pending') {
				await unboop({ ...ctx,  preboop: true }, "tests are pending");
			} else {
				await unboop(ctx, "go fix unbooper, shouldn't hit this code path, sorry!");
			}
		} else if (reviews.length && reviews.find(r => r.state === 'CHANGES_REQUESTED')) {
			await unboop(
				ctx,
				"changes requested. Make sure to address everyone's comments and dismiss any reviews before booping.",
			);
		} else if (reviews.length && reviews.find(r => r.state === 'APPROVED')) {
			await unboop(ctx, "approved");
		} else if (mentalOverhead(diff) > 3000 && !refactor) {
      // rules for PR LOC:
      // - unboop after too much overhead
      // - put [refactor] in the title to allow big PRs
      // - warn when the PR starts getting large

			await unboop(
				ctx,
				`Your PR is too powerful! Try breaking it up into multiple changes.
If this is a **pure** refactor you can put \`[refactor]\` in the title.`,
			);
		} else if (mentalOverhead(diff) > 300 && !refactor) {
			await warn(ctx, 'hefty', `This PR is getting big.
To make it easier for others to review you might want to breaking it up into smaller changes.`);
		} else if (touchedDeps(diff)) {
      warn(ctx, 'deps', `warning: This PR touches the dependencies!

When we're pulling in a dependency we're now maintaining it, it is no different from code we have in our repos.

Please make sure:
- [ ] You pull in new dependencies in a separate PR.
- [ ] You read and understand the code you're pulling in.
- [ ] Doesn't have security holes.
- [ ] It's doesn't add a lot to the bundle size.
- [ ] It isn't a solution that is over engineered.
- [ ] You consider vendoring it.

If you are upgrading a dependency please make sure to update related dependencies

If you're reviewing this PR, please review the dependencies and go checkout the source.
`)
    } 
    
    // at this point the PR better be okay, maybe we'll give it some kudos
    else if (mentalOverhead(diff) <= bopOverhead) {
      await warn(ctx, 'bop', `Good work, this PRs short and easy to review! Promoting to \`bop\`.`);
    }
	}

	console.log('boop check complete!' , new Date());
}

boopcheck()
setInterval(boopcheck, 60000);