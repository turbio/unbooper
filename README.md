# unbooper

Unboop unworthy boops. Meant to be used in conjunction with [boops](https://github.com/turbio/boops).

This periodically checks all the booped pull requests for violations. 

## the rules (so far)
- a title containing `[rfc]` is always allowed to be booped
- the pull request must not be merged
- tests must be passing
- there are no pending changes requested
- the pull request has not be approved
- the mental overhead is within reason (that is: the number of meaningful additions)
- if the diff touches dependencies it will be warned
- good boops turn into bops

the tag `preboop` will also add the tag `boop` if all the rules are satisfied.