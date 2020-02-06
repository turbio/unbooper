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
			owner,
			repo,
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

		console.log(title, 'cost', overhead);

		if (title.toLowerCase().includes('wip')) {
			await unboop({ owner, repo, pull_number }, "\"WIP\" is in the title");
		} else if (body.toLowerCase().includes('wip')) {
			await unboop({ owner, repo, pull_number }, "\"WIP\" is in the description");
		} else if (!pull.mergeable && false) { // TODO(turbio): this doesn't seem reliable
			await unboop({ owner, repo, pull_number }, "not mergeable");
		} else if (pull.merged) {
			await unboop({ owner, repo, pull_number }, "already merged");
		} else if (statuses.length && !statuses.find(s => s.state === 'success')) {
			await unboop({ owner, repo, pull_number, preboop: !(statuses[0].state === 'failure' || statuses[0].state === 'error') }, "tests don't pass");
		} else if (reviews.length && reviews.find(r => r.state === 'CHANGES_REQUESTED')) {
			await unboop(
				{ owner, repo, pull_number },
				"changes requested. Make sure to address everyone's comments and dismiss any reviews before booping.",
			);
		} else if (reviews.length && reviews.find(r => r.state === 'APPROVED')) {
			await unboop({ owner, repo, pull_number }, "approved");
		}
		// rules for PR LOC:
		// - unboop after 300
		// - put [refactor] in the title to allow big PRs, but it MUST be a pure refactor
		else if (overhead > 300 && !title.toLowerCase().includes('[refactor]')) {
			await unboop(
				{ owner, repo, pull_number },
				`Your PR is too powerful! Try breaking it up into multiple changes.
If this is a **pure** refactor you can put [refactor] in the title.`,
			);
		}
	}

	console.log('boop check complete!');
}

const express = require('express');

const app = express();

app.get(`/${process.env.RUN_BOOP_URL}`, async (req, res) => {
	try {
		await boopcheck();
	} catch (e) {
		console.log(e.toString())
		res.send(e.toString())
		return
	}
	res.send('boop check complete!');
});

app.listen(3000, () => console.log(`we up bois`));