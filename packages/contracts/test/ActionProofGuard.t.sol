// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ActionProofGuard } from "../src/ActionProofGuard.sol";
import { DemoCounter } from "../src/DemoCounter.sol";
import { DemoToken } from "../src/DemoToken.sol";
import { ReentrantTarget } from "../src/ReentrantTarget.sol";
import { TestBase } from "./TestBase.sol";

contract ActionProofGuardTest is TestBase {
    uint256 private constant VERIFIER_KEY = 0xA11CE;
    uint256 private constant SECOND_VERIFIER_KEY = 0xB0B;
    uint256 private constant START_TIME = 1_800_000_000;

    ActionProofGuard private guard;
    DemoCounter private counter;
    address private verifier;
    address private requester;
    address private agent;
    address private anchorRelayer;
    address private executionRelayer;

    function setUp() public {
        vm.warp(START_TIME);
        verifier = vm.addr(VERIFIER_KEY);
        requester = vm.addr(0xCAFE);
        agent = vm.addr(0xA63A7);
        anchorRelayer = vm.addr(0xA11);
        executionRelayer = vm.addr(0xE11);

        guard = new ActionProofGuard(verifier);
        counter = new DemoCounter();
        vm.deal(executionRelayer, 100 ether);
    }

    function test_ConstructorRejectsZeroVerifier() public {
        vm.expectRevert(ActionProofGuard.ZeroAddress.selector);
        new ActionProofGuard(address(0));
    }

    function test_Eip712ConstantsMatchCore() public view {
        assertEq(keccak256(bytes(guard.NAME())), keccak256("ActionProof"));
        assertEq(keccak256(bytes(guard.VERSION())), keccak256("1"));
        assertEq(
            guard.ACTION_ATTESTATION_TYPEHASH(),
            keccak256(
                "ActionAttestation(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,bytes32 reportRoot,bytes32 reportHash,uint8 verdict,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)"
            )
        );
        assertEq(
            guard.ACTION_REQUEST_TYPEHASH(),
            keccak256(
                "ActionRequest(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)"
            )
        );

        bytes32 expectedDomain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ActionProof"),
                keccak256("1"),
                block.chainid,
                address(guard)
            )
        );
        assertEq(guard.domainSeparatorV4(), expectedDomain);
    }

    function test_HashActionRequestMatchesCoreEncoding() public view {
        bytes memory action = abi.encodeCall(DemoCounter.setNumber, (42));
        ActionProofGuard.ActionRequest memory request = ActionProofGuard.ActionRequest({
            agent: agent,
            requester: requester,
            target: address(counter),
            value: 7,
            calldataHash: keccak256(action),
            intentHash: keccak256("set the counter"),
            destinationChainId: block.chainid,
            nonce: 9,
            issuedAt: uint64(block.timestamp - 1),
            expiresAt: uint64(block.timestamp + 5 minutes)
        });
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "ActionRequest(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)"
                ),
                request.agent,
                request.requester,
                request.target,
                request.value,
                request.calldataHash,
                request.intentHash,
                request.destinationChainId,
                request.nonce,
                request.issuedAt,
                request.expiresAt
            )
        );
        assertEq(guard.hashActionRequest(request), expected);
    }

    function test_AnchorThenExecuteUsesSeparateReplayBarriers() public {
        bytes memory action = abi.encodeCall(DemoCounter.setNumber, (42));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0.25 ether, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = guard.hashAttestation(attestation);

        vm.prank(anchorRelayer);
        assertEq(guard.anchorAttestation(attestation, signature), digest);

        assertTrue(guard.usedAttestations(digest));
        assertFalse(guard.executedAttestations(digest));
        assertEq(guard.nextNonce(agent, requester), 1);
        (
            address anchoredAgent,
            address anchoredRequester,
            address anchoredVerifier,
            bytes32 reportRoot,
            bytes32 reportHash,
            uint8 verdict,
            uint64 anchoredAt
        ) = guard.anchors(digest);
        assertEq(anchoredAgent, agent);
        assertEq(anchoredRequester, requester);
        assertEq(anchoredVerifier, verifier);
        assertEq(reportRoot, attestation.reportRoot);
        assertEq(reportHash, attestation.reportHash);
        assertEq(uint256(verdict), uint256(guard.VERDICT_SAFE()));
        assertEq(uint256(anchoredAt), block.timestamp);

        vm.prank(executionRelayer);
        bytes memory returnData =
            guard.executeAttestedAction{ value: 0.25 ether }(attestation, action, signature);

        assertEq(abi.decode(returnData, (uint256)), 42);
        assertEq(counter.number(), 42);
        assertEq(counter.totalValueReceived(), 0.25 ether);
        assertEq(counter.lastCaller(), address(guard));
        assertTrue(guard.executedAttestations(digest));
        assertEq(guard.nextNonce(agent, requester), 1);
    }

    function test_AnyoneCanRelayAnchorAndExecution() public {
        address arbitraryAnchorRelayer = vm.addr(0x123456);
        address arbitraryExecutionRelayer = vm.addr(0x654321);
        vm.deal(arbitraryExecutionRelayer, 1 ether);
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);

        assertTrue(arbitraryAnchorRelayer != requester);
        assertTrue(arbitraryExecutionRelayer != requester);
        vm.prank(arbitraryAnchorRelayer);
        guard.anchorAttestation(attestation, signature);
        vm.prank(arbitraryExecutionRelayer);
        guard.executeAttestedAction(attestation, action, signature);

        assertEq(counter.number(), 1);
    }

    function test_ExecutionRequiresPriorAnchor() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = guard.hashAttestation(attestation);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.AttestationNotAnchored.selector, digest)
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);
    }

    function test_DuplicateAnchorIsRejected() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = _anchor(attestation, signature);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.AttestationAlreadyUsed.selector, digest)
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function test_DuplicateExecutionIsRejected() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = _anchor(attestation, signature);

        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.AttestationAlreadyExecuted.selector, digest)
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);
    }

    function test_AnchorPinsVerifierAcrossRotation() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory oldAttestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory oldSignature = _sign(guard, oldAttestation, VERIFIER_KEY);
        bytes32 oldDigest = _anchor(oldAttestation, oldSignature);

        address nextVerifier = vm.addr(SECOND_VERIFIER_KEY);
        guard.setAuthorizedVerifier(nextVerifier);

        (,, address pinnedVerifier,,,,) = guard.anchors(oldDigest);
        assertEq(pinnedVerifier, verifier);
        vm.prank(executionRelayer);
        guard.executeAttestedAction(oldAttestation, action, oldSignature);

        ActionProofGuard.ActionAttestation memory newAttestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 1);
        bytes memory newSignature = _sign(guard, newAttestation, SECOND_VERIFIER_KEY);
        bytes32 newDigest = _anchor(newAttestation, newSignature);
        (,, pinnedVerifier,,,,) = guard.anchors(newDigest);
        assertEq(pinnedVerifier, nextVerifier);
    }

    function test_ExecutionRechecksSignatureAgainstPinnedVerifier() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory validSignature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, validSignature);

        address wrongSigner = vm.addr(SECOND_VERIFIER_KEY);
        bytes memory wrongSignature = _sign(guard, attestation, SECOND_VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidVerifier.selector, wrongSigner)
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, wrongSignature);
    }

    function test_UnsafeAndReviewVerdictsAnchorButNeverExecute() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory blocked =
            _attestation(address(counter), action, 0, guard.VERDICT_UNSAFE(), 0);
        bytes memory blockedSignature = _sign(guard, blocked, VERIFIER_KEY);
        bytes32 blockedDigest = _anchor(blocked, blockedSignature);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.UnsafeVerdict.selector, guard.VERDICT_UNSAFE())
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(blocked, action, blockedSignature);
        assertFalse(guard.executedAttestations(blockedDigest));

        ActionProofGuard.ActionAttestation memory review =
            _attestation(address(counter), action, 0, guard.VERDICT_REVIEW(), 1);
        bytes memory reviewSignature = _sign(guard, review, VERIFIER_KEY);
        bytes32 reviewDigest = _anchor(review, reviewSignature);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.UnsafeVerdict.selector, guard.VERDICT_REVIEW())
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(review, action, reviewSignature);
        assertFalse(guard.executedAttestations(reviewDigest));
        assertEq(guard.nextNonce(agent, requester), 2);
        assertEq(counter.callCount(), 0);
    }

    function test_SuccessiveAnchorsConsumeNoncesInOrder() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory first =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        _anchor(first, _sign(guard, first, VERIFIER_KEY));

        ActionProofGuard.ActionAttestation memory second =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 1);
        _anchor(second, _sign(guard, second, VERIFIER_KEY));
        assertEq(guard.nextNonce(agent, requester), 2);
    }

    function test_NonceGapIsRejectedAtAnchor() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 7);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);

        vm.expectRevert(abi.encodeWithSelector(ActionProofGuard.NonceOutOfSequence.selector, 0, 7));
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function test_NonceLanesAreIndependent() public {
        address otherAgent = vm.addr(0x1234);
        address otherRequester = vm.addr(0x5678);
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());

        ActionProofGuard.ActionAttestation memory first =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        _anchor(first, _sign(guard, first, VERIFIER_KEY));

        ActionProofGuard.ActionAttestation memory second = first;
        second.agent = otherAgent;
        second.requester = otherRequester;
        second.reportHash = keccak256("independent report");
        _anchor(second, _sign(guard, second, VERIFIER_KEY));

        assertEq(guard.nextNonce(agent, requester), 1);
        assertEq(guard.nextNonce(otherAgent, otherRequester), 1);
    }

    function test_OnlyCurrentVerifierCanAnchor() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        address wrongSigner = vm.addr(SECOND_VERIFIER_KEY);
        bytes memory wrongSignature = _sign(guard, attestation, SECOND_VERIFIER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidVerifier.selector, wrongSigner)
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, wrongSignature);
    }

    function test_VerifierRotationIsOwnerOnly() public {
        address nextVerifier = vm.addr(SECOND_VERIFIER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ActionProofGuard.NotOwner.selector, anchorRelayer));
        vm.prank(anchorRelayer);
        guard.setAuthorizedVerifier(nextVerifier);

        guard.setAuthorizedVerifier(nextVerifier);
        assertEq(guard.authorizedVerifier(), nextVerifier);
    }

    function test_ActualCalldataMustMatchAnchoredHash() public {
        bytes memory signedAction = abi.encodeCall(DemoCounter.setNumber, (1));
        bytes memory submittedAction = abi.encodeCall(DemoCounter.setNumber, (2));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), signedAction, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, signature);

        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.CalldataHashMismatch.selector,
                keccak256(signedAction),
                keccak256(submittedAction)
            )
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, submittedAction, signature);
    }

    function test_ActualValueMustMatchAnchoredValue() public {
        bytes memory action = abi.encodeCall(DemoCounter.setNumber, (1));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 1 ether, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, signature);

        vm.expectRevert(abi.encodeWithSelector(ActionProofGuard.ValueMismatch.selector, 1 ether, 0));
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);
    }

    function test_DestinationChainMustMatchAtAnchor() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        attestation.destinationChainId = block.chainid + 1;
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.DestinationChainMismatch.selector, block.chainid, block.chainid + 1
            )
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function test_AttestationCannotExecuteAfterExpiry() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = _anchor(attestation, signature);
        vm.warp(attestation.expiresAt);

        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.AttestationExpired.selector, attestation.expiresAt, block.timestamp
            )
        );
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);

        assertTrue(guard.usedAttestations(digest));
        assertFalse(guard.executedAttestations(digest));
        assertEq(guard.nextNonce(agent, requester), 1);
    }

    function test_FutureExpiredAndMalformedWindowsFailAtAnchor() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);

        attestation.issuedAt = uint64(block.timestamp + 1);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.AttestationNotYetValid.selector,
                attestation.issuedAt,
                block.timestamp
            )
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);

        attestation.issuedAt = uint64(block.timestamp - 1);
        attestation.expiresAt = uint64(block.timestamp);
        signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.AttestationExpired.selector, attestation.expiresAt, block.timestamp
            )
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);

        attestation.issuedAt = uint64(block.timestamp);
        attestation.expiresAt = uint64(block.timestamp);
        signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ActionProofGuard.InvalidTimeWindow.selector,
                attestation.issuedAt,
                attestation.expiresAt
            )
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function test_RequiredEvidenceHashesCannotBeEmpty() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);

        attestation.intentHash = bytes32(0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(ActionProofGuard.MissingIntentHash.selector);
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);

        attestation.intentHash = keccak256("intent");
        attestation.reportRoot = bytes32(0);
        signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(ActionProofGuard.MissingReportRoot.selector);
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);

        attestation.reportRoot = keccak256("root");
        attestation.reportHash = bytes32(0);
        signature = _sign(guard, attestation, VERIFIER_KEY);
        vm.expectRevert(ActionProofGuard.MissingReportHash.selector);
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function test_SignaturesAreBoundToGuardContractAndChain() public {
        ActionProofGuard otherGuard = new ActionProofGuard(verifier);
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signatureForFirstGuard = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 otherDigest = otherGuard.hashAttestation(attestation);
        address otherRecovered = otherGuard.recoverSigner(otherDigest, signatureForFirstGuard);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidVerifier.selector, otherRecovered)
        );
        vm.prank(anchorRelayer);
        otherGuard.anchorAttestation(attestation, signatureForFirstGuard);

        uint256 nextChainId = block.chainid + 1;
        attestation.destinationChainId = nextChainId;
        bytes memory signatureForOldDomain = _sign(guard, attestation, VERIFIER_KEY);
        vm.chainId(nextChainId);
        bytes32 newDomainDigest = guard.hashAttestation(attestation);
        address newDomainRecovered = guard.recoverSigner(newDomainDigest, signatureForOldDomain);
        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidVerifier.selector, newDomainRecovered)
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signatureForOldDomain);
    }

    function test_RejectsMalformedAndMalleableSignatures() public {
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidSignatureLength.selector, 64)
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, new bytes(64));

        bytes memory badV = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(1));
        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.InvalidSignatureV.selector, uint8(1))
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, badV);

        bytes32 highS = bytes32(type(uint256).max);
        bytes memory badS = abi.encodePacked(bytes32(uint256(1)), highS, uint8(27));
        vm.expectRevert(abi.encodeWithSelector(ActionProofGuard.InvalidSignatureS.selector, highS));
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, badS);
    }

    function test_DownstreamRevertPreservesAnchorAndAllowsRetry() public {
        bytes memory action = abi.encodeCall(DemoCounter.fail, (77));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        bytes32 digest = _anchor(attestation, signature);

        vm.expectRevert(abi.encodeWithSelector(DemoCounter.ForcedFailure.selector, 77));
        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);

        assertTrue(guard.usedAttestations(digest));
        assertFalse(guard.executedAttestations(digest));
        assertEq(guard.nextNonce(agent, requester), 1);
        (,, address pinnedVerifier,,,, uint64 anchoredAt) = guard.anchors(digest);
        assertEq(pinnedVerifier, verifier);
        assertEq(uint256(anchoredAt), block.timestamp);
    }

    function test_ReentrantTargetCannotEnterExecution() public {
        ReentrantTarget target = new ReentrantTarget(address(guard));

        bytes memory outerAction = abi.encodeCall(ReentrantTarget.triggerReentry, ());
        ActionProofGuard.ActionAttestation memory outer =
            _attestation(address(target), outerAction, 0, guard.VERDICT_SAFE(), 0);
        bytes memory outerSignature = _sign(guard, outer, VERIFIER_KEY);
        bytes32 outerDigest = _anchor(outer, outerSignature);

        bytes memory innerAction = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory inner =
            _attestation(address(counter), innerAction, 0, guard.VERDICT_SAFE(), 1);
        bytes memory innerSignature = _sign(guard, inner, VERIFIER_KEY);
        bytes32 innerDigest = _anchor(inner, innerSignature);
        target.setReentryPayload(
            abi.encodeCall(
                ActionProofGuard.executeAttestedAction, (inner, innerAction, innerSignature)
            )
        );

        vm.expectRevert(ActionProofGuard.ReentrantCall.selector);
        vm.prank(executionRelayer);
        guard.executeAttestedAction(outer, outerAction, outerSignature);

        assertFalse(guard.executedAttestations(outerDigest));
        assertFalse(guard.executedAttestations(innerDigest));
        assertTrue(guard.usedAttestations(outerDigest));
        assertTrue(guard.usedAttestations(innerDigest));
        assertEq(guard.nextNonce(agent, requester), 2);
    }

    function test_GuardCanExecuteDemoTokenTransfer() public {
        DemoToken token = new DemoToken(address(guard), 1_000 ether);
        address recipient = vm.addr(0xF00D);
        bytes memory action = abi.encodeCall(DemoToken.transfer, (recipient, 25 ether));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(token), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, signature);

        vm.prank(executionRelayer);
        bytes memory result = guard.executeAttestedAction(attestation, action, signature);
        assertTrue(abi.decode(result, (bool)));
        assertEq(token.balanceOf(recipient), 25 ether);
        assertEq(token.balanceOf(address(guard)), 975 ether);
    }

    function testFuzz_AnchorThenExecuteExactCalldataAndValue(uint256 newNumber, uint96 rawValue)
        public
    {
        uint256 callValue = bound(uint256(rawValue), 0, 10 ether);
        bytes memory action = abi.encodeCall(DemoCounter.setNumber, (newNumber));
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, callValue, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, signature);

        vm.prank(executionRelayer);
        guard.executeAttestedAction{ value: callValue }(attestation, action, signature);
        assertEq(counter.number(), newNumber);
        assertEq(counter.totalValueReceived(), callValue);
    }

    function testFuzz_AllAttestationFieldsAreTamperEvident(uint8 fieldSeed, bytes32 mutation)
        public
    {
        bytes memory action = abi.encodeCall(DemoCounter.setNumber, (99));
        ActionProofGuard.ActionAttestation memory original =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        bytes memory signature = _sign(guard, original, VERIFIER_KEY);
        ActionProofGuard.ActionAttestation memory changed = original;
        bytes32 nonZeroMutation = mutation == bytes32(0) ? bytes32(uint256(1)) : mutation;
        uint8 field = fieldSeed % 13;

        if (field == 0) {
            changed.agent = _differentAddress(nonZeroMutation, original.agent, address(0x1111));
        } else if (field == 1) {
            changed.requester =
                _differentAddress(nonZeroMutation, original.requester, address(0x2222));
        } else if (field == 2) {
            changed.target = _differentAddress(nonZeroMutation, original.target, address(0x3333));
        } else if (field == 3) {
            changed.value = 1;
        } else if (field == 4) {
            changed.calldataHash = _differentHash(nonZeroMutation, original.calldataHash);
        } else if (field == 5) {
            changed.intentHash = _differentHash(nonZeroMutation, original.intentHash);
        } else if (field == 6) {
            changed.reportRoot = _differentHash(nonZeroMutation, original.reportRoot);
        } else if (field == 7) {
            changed.reportHash = _differentHash(nonZeroMutation, original.reportHash);
        } else if (field == 8) {
            changed.verdict = guard.VERDICT_REVIEW();
        } else if (field == 9) {
            changed.destinationChainId = block.chainid + 1;
        } else if (field == 10) {
            changed.nonce = 1;
        } else if (field == 11) {
            changed.issuedAt = original.issuedAt - 1;
        } else {
            changed.expiresAt = original.expiresAt + 1;
        }

        vm.prank(anchorRelayer);
        (bool success,) = address(guard)
            .call(abi.encodeCall(ActionProofGuard.anchorAttestation, (changed, signature)));
        assertFalse(success);
        assertEq(guard.nextNonce(agent, requester), 0);
    }

    function testFuzz_ValidDeadlineWindowSupportsBothTransactions(uint32 rawLifetime) public {
        uint256 lifetime = bound(uint256(rawLifetime), 1, 30 days);
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), 0);
        attestation.issuedAt = uint64(block.timestamp);
        attestation.expiresAt = uint64(block.timestamp + lifetime);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);
        _anchor(attestation, signature);

        vm.prank(executionRelayer);
        guard.executeAttestedAction(attestation, action, signature);
        assertEq(counter.number(), 1);
    }

    function testFuzz_NonceMustEqualExactNextNonce(uint256 suppliedNonce) public {
        vm.assume(suppliedNonce != 0);
        bytes memory action = abi.encodeCall(DemoCounter.increment, ());
        ActionProofGuard.ActionAttestation memory attestation =
            _attestation(address(counter), action, 0, guard.VERDICT_SAFE(), suppliedNonce);
        bytes memory signature = _sign(guard, attestation, VERIFIER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(ActionProofGuard.NonceOutOfSequence.selector, 0, suppliedNonce)
        );
        vm.prank(anchorRelayer);
        guard.anchorAttestation(attestation, signature);
    }

    function _anchor(ActionProofGuard.ActionAttestation memory attestation, bytes memory signature)
        private
        returns (bytes32 digest)
    {
        vm.prank(anchorRelayer);
        digest = guard.anchorAttestation(attestation, signature);
    }

    function _attestation(
        address target,
        bytes memory action,
        uint256 value,
        uint8 verdict,
        uint256 nonce
    ) private view returns (ActionProofGuard.ActionAttestation memory attestation) {
        attestation = ActionProofGuard.ActionAttestation({
            agent: agent,
            requester: requester,
            target: target,
            value: value,
            calldataHash: keccak256(action),
            intentHash: keccak256("intent"),
            reportRoot: keccak256("report root"),
            reportHash: keccak256("report"),
            verdict: verdict,
            destinationChainId: block.chainid,
            nonce: nonce,
            issuedAt: uint64(block.timestamp - 1),
            expiresAt: uint64(block.timestamp + 5 minutes)
        });
    }

    function _sign(
        ActionProofGuard signingGuard,
        ActionProofGuard.ActionAttestation memory attestation,
        uint256 privateKey
    ) private returns (bytes memory signature) {
        bytes32 digest = signingGuard.hashAttestation(attestation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _differentAddress(bytes32 mutation, address original, address fallbackAddress)
        private
        pure
        returns (address candidate)
    {
        candidate = address(uint160(uint256(mutation)));
        if (candidate == address(0) || candidate == original) candidate = fallbackAddress;
    }

    function _differentHash(bytes32 mutation, bytes32 original) private pure returns (bytes32) {
        return mutation == original ? keccak256(abi.encode(mutation)) : mutation;
    }
}
