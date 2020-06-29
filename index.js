const Octokit = require('@octokit/rest')
const octokit = new Octokit({ auth: process.env.TOKEN });

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

async function boopcheck() {
	console.log('running boop check');
	const { data } = await octokit.issues.list({
		filter: 'all',
		state: 'open',
		labels: ['boop']
	});

	for (const issue of data) {
		const { number: pull_number, repository, title, body } = issue;
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

		const { data: statuses } = await octokit.repos.listStatusesForRef({
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

		// try to encourage easy to review PRs. A negative mental overhead should lead to rejection.
		// currently we'll allow a diff with 300 "meaningful" additions.
		const overhead = mentalOverhead(diff);

		const ctx = {
			pull_number,
			issue_number: pull_number,
			owner,
			repo,
			labels: issue.labels,
		};

		const refactor = title.toLowerCase().includes('[refactor]');
		const rfc = title.toLowerCase().includes('[rfc]');

		if (rfc) {
			// seems alright to me
		} else if (title.toLowerCase().includes('wip')) {
			await unboop(ctx, "\"WIP\" is in the title");
		} else if (body.toLowerCase().includes('wip')) {
			await unboop(ctx, "\"WIP\" is in the description");
		} else if (!pull.mergeable && false) { // TODO(turbio): this doesn't seem reliable
			await unboop(ctx, "not mergeable");
		} else if (pull.merged) {
			await unboop(ctx, "already merged");
		} else if (statuses.length && !statuses.find(s => s.state === 'success')) {
			await unboop({ owner, repo, pull_number, preboop: !(statuses[0].state === 'failure' || statuses[0].state === 'error') }, "tests don't pass");
		} else if (reviews.length && reviews.find(r => r.state === 'CHANGES_REQUESTED')) {
			await unboop(
				ctx,
				"changes requested. Make sure to address everyone's comments and dismiss any reviews before booping.",
			);
		} else if (reviews.length && reviews.find(r => r.state === 'APPROVED')) {
			await unboop(ctx, "approved");
		}
		// rules for PR LOC:
		// - unboop after too much overhead
		// - put [refactor] in the title to allow big PRs
		// - warn when the PR starts getting large
		else if (overhead > 3000 && !refactor) {
			await unboop(
				ctx,
				`Your PR is too powerful! Try breaking it up into multiple changes.
If this is a **pure** refactor you can put \`[refactor]\` in the title.`,
			);
		} else if (overhead > 300 && !refactor) {
			await warn(ctx, 'hefty', `This PR is getting big.
To make it easier for others to review you might want to breaking it up into smaller changes.`);
		}
	}

	console.log('boop check complete!' , new Date());
}

setInterval(boopcheck, 600000)