# unbooper

Unboop unworthy boops. Meant to be used in conjunction with [boops](https://github.com/turbio/boops).

This periodically checks all the booped pull requests for violations. 

## the rules (so far)
- a title containing `[rfc]` is always allowed to be booped
- title and body cannot contain `/\bwip\b/`
- the pull request must not be merged
- tests must be passing
- there are no pending changes requested
- the pull request has not be approved
- the mental overhead is within reason (that is: the number of meaningful additions)

the tag `preboop` will also add the tag `boop` if all the rules are satisfied.