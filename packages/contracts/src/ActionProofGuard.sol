// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ActionProofGuard
/// @notice Anchors verifier attestations and executes already-anchored SAFE actions.
/// @dev Nonces are sequential per (agent, requester) lane and consumed at anchor time. Execution
///      has a separate replay barrier. The EIP-712 domain binds signatures to this guard and chain.
contract ActionProofGuard {
    string public constant NAME = "ActionProof";
    string public constant VERSION = "1";

    uint8 public constant VERDICT_SAFE = 1;
    uint8 public constant VERDICT_UNSAFE = 2;
    uint8 public constant VERDICT_REVIEW = 3;

    bytes32 public constant ACTION_ATTESTATION_TYPEHASH = keccak256(
        "ActionAttestation(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,bytes32 reportRoot,bytes32 reportHash,uint8 verdict,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)"
    );
    bytes32 public constant ACTION_REQUEST_TYPEHASH = keccak256(
        "ActionRequest(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)"
    );
    bytes32 private constant _EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant _NAME_HASH = keccak256(bytes(NAME));
    bytes32 private constant _VERSION_HASH = keccak256(bytes(VERSION));
    uint256 private constant _SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct ActionAttestation {
        address agent;
        address requester;
        address target;
        uint256 value;
        bytes32 calldataHash;
        bytes32 intentHash;
        bytes32 reportRoot;
        bytes32 reportHash;
        uint8 verdict;
        uint256 destinationChainId;
        uint256 nonce;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct ActionRequest {
        address agent;
        address requester;
        address target;
        uint256 value;
        bytes32 calldataHash;
        bytes32 intentHash;
        uint256 destinationChainId;
        uint256 nonce;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct Anchor {
        address agent;
        address requester;
        address verifier;
        bytes32 reportRoot;
        bytes32 reportHash;
        uint8 verdict;
        uint64 anchoredAt;
    }

    error ZeroAddress();
    error NotOwner(address caller);
    error InvalidVerifier(address recovered);
    error InvalidSignatureLength(uint256 length);
    error InvalidSignatureS(bytes32 s);
    error InvalidSignatureV(uint8 v);
    error ZeroAgent();
    error MissingIntentHash();
    error MissingReportRoot();
    error MissingReportHash();
    error InvalidVerdict(uint8 verdict);
    error UnsafeVerdict(uint8 verdict);
    error CalldataHashMismatch(bytes32 expected, bytes32 actual);
    error ValueMismatch(uint256 expected, uint256 actual);
    error DestinationChainMismatch(uint256 expected, uint256 actual);
    error InvalidTimeWindow(uint64 issuedAt, uint64 expiresAt);
    error AttestationNotYetValid(uint64 issuedAt, uint256 currentTime);
    error AttestationExpired(uint64 expiresAt, uint256 currentTime);
    error AttestationAlreadyUsed(bytes32 digest);
    error AttestationNotAnchored(bytes32 digest);
    error AttestationAlreadyExecuted(bytes32 digest);
    error NonceOutOfSequence(uint256 expected, uint256 actual);
    error ReentrantCall();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AuthorizedVerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event AttestationAnchored(
        bytes32 indexed digest,
        address indexed agent,
        address indexed requester,
        address verifier,
        bytes32 reportRoot,
        bytes32 reportHash,
        uint8 verdict,
        uint256 nonce
    );
    event ActionExecuted(
        bytes32 indexed digest,
        address indexed target,
        uint256 value,
        bytes32 calldataHash,
        bytes32 returnDataHash,
        uint256 nonce
    );

    address public owner;
    address public authorizedVerifier;

    uint256 private immutable _initialChainId;
    bytes32 private immutable _initialDomainSeparator;
    uint256 private _reentrancyStatus = 1;

    mapping(bytes32 lane => uint256 nonce) private _nextNonces;
    mapping(bytes32 digest => bool used) public usedAttestations;
    mapping(bytes32 digest => bool executed) public executedAttestations;
    mapping(bytes32 digest => Anchor anchor) public anchors;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert ReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    constructor(address initialVerifier) {
        if (initialVerifier == address(0)) revert ZeroAddress();

        owner = msg.sender;
        authorizedVerifier = initialVerifier;
        _initialChainId = block.chainid;
        _initialDomainSeparator = _buildDomainSeparator();

        emit OwnershipTransferred(address(0), msg.sender);
        emit AuthorizedVerifierUpdated(address(0), initialVerifier);
    }

    /// @notice Updates the sole verifier whose ECDSA signatures are accepted.
    function setAuthorizedVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        address previousVerifier = authorizedVerifier;
        authorizedVerifier = newVerifier;
        emit AuthorizedVerifierUpdated(previousVerifier, newVerifier);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @notice Records a verifier-approved report without executing its action.
    /// @dev SAFE, UNSAFE, and REVIEW verdicts may be anchored. Anchoring consumes the lane nonce.
    function anchorAttestation(ActionAttestation calldata attestation, bytes calldata signature)
        external
        nonReentrant
        returns (bytes32 digest)
    {
        _validateAttestation(attestation);

        digest = hashAttestation(attestation);
        if (usedAttestations[digest]) revert AttestationAlreadyUsed(digest);

        address verifier = authorizedVerifier;
        address recovered = recoverSigner(digest, signature);
        if (recovered != verifier) revert InvalidVerifier(recovered);

        bytes32 lane = nonceLane(attestation.agent, attestation.requester);
        uint256 expectedNonce = _nextNonces[lane];
        if (attestation.nonce != expectedNonce) {
            revert NonceOutOfSequence(expectedNonce, attestation.nonce);
        }

        usedAttestations[digest] = true;
        _nextNonces[lane] = expectedNonce + 1;
        anchors[digest] = Anchor({
            agent: attestation.agent,
            requester: attestation.requester,
            verifier: verifier,
            reportRoot: attestation.reportRoot,
            reportHash: attestation.reportHash,
            verdict: attestation.verdict,
            anchoredAt: uint64(block.timestamp)
        });

        emit AttestationAnchored(
            digest,
            attestation.agent,
            attestation.requester,
            verifier,
            attestation.reportRoot,
            attestation.reportHash,
            attestation.verdict,
            attestation.nonce
        );
    }

    /// @notice Executes the exact action authorized by an already-anchored SAFE attestation.
    /// @return returnData Exact bytes returned by the downstream target.
    function executeAttestedAction(
        ActionAttestation calldata attestation,
        bytes calldata actionCalldata,
        bytes calldata signature
    ) external payable nonReentrant returns (bytes memory returnData) {
        if (attestation.verdict != VERDICT_SAFE) {
            revert UnsafeVerdict(attestation.verdict);
        }
        _validateAttestation(attestation);

        bytes32 actualCalldataHash = keccak256(actionCalldata);
        if (attestation.calldataHash != actualCalldataHash) {
            revert CalldataHashMismatch(attestation.calldataHash, actualCalldataHash);
        }
        if (msg.value != attestation.value) {
            revert ValueMismatch(attestation.value, msg.value);
        }

        bytes32 digest = hashAttestation(attestation);
        Anchor storage anchor = anchors[digest];
        address anchoredVerifier = anchor.verifier;
        if (anchoredVerifier == address(0)) revert AttestationNotAnchored(digest);
        if (executedAttestations[digest]) revert AttestationAlreadyExecuted(digest);

        address recovered = recoverSigner(digest, signature);
        if (recovered != anchoredVerifier) revert InvalidVerifier(recovered);

        // Checks-effects-interactions. A downstream revert rolls this execution flag back while
        // preserving the anchor and nonce consumed by the earlier anchor transaction.
        executedAttestations[digest] = true;

        (bool success, bytes memory result) =
            attestation.target.call{ value: attestation.value }(actionCalldata);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }

        _emitActionExecuted(attestation, digest, keccak256(result));
        return result;
    }

    function nextNonce(address agent, address requester) external view returns (uint256) {
        return _nextNonces[nonceLane(agent, requester)];
    }

    function nonceLane(address agent, address requester) public pure returns (bytes32) {
        return keccak256(abi.encode(agent, requester));
    }

    function domainSeparatorV4() public view returns (bytes32) {
        return block.chainid == _initialChainId ? _initialDomainSeparator : _buildDomainSeparator();
    }

    function hashAttestationStruct(ActionAttestation calldata attestation)
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ACTION_ATTESTATION_TYPEHASH,
                attestation.agent,
                attestation.requester,
                attestation.target,
                attestation.value,
                attestation.calldataHash,
                attestation.intentHash,
                attestation.reportRoot,
                attestation.reportHash,
                attestation.verdict,
                attestation.destinationChainId,
                attestation.nonce,
                attestation.issuedAt,
                attestation.expiresAt
            )
        );
    }

    /// @notice Hashes the canonical ActionRequest struct exactly as @actionproof/core does.
    /// @dev This is the EIP-712-style struct hash only; it intentionally excludes the domain.
    function hashActionRequest(ActionRequest calldata request) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ACTION_REQUEST_TYPEHASH,
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
    }

    function hashAttestation(ActionAttestation calldata attestation) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", domainSeparatorV4(), hashAttestationStruct(attestation))
        );
    }

    function recoverSigner(bytes32 digest, bytes calldata signature)
        public
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert InvalidSignatureLength(signature.length);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (uint256(s) > _SECP256K1N_DIV_2) revert InvalidSignatureS(s);
        if (v != 27 && v != 28) revert InvalidSignatureV(v);
        signer = ecrecover(digest, v, r, s);
    }

    function _validateAttestation(ActionAttestation calldata attestation) private view {
        if (attestation.agent == address(0)) revert ZeroAgent();
        if (attestation.requester == address(0) || attestation.target == address(0)) {
            revert ZeroAddress();
        }
        if (attestation.intentHash == bytes32(0)) revert MissingIntentHash();
        if (attestation.reportRoot == bytes32(0)) revert MissingReportRoot();
        if (attestation.reportHash == bytes32(0)) revert MissingReportHash();
        if (
            attestation.verdict != VERDICT_SAFE && attestation.verdict != VERDICT_UNSAFE
                && attestation.verdict != VERDICT_REVIEW
        ) {
            revert InvalidVerdict(attestation.verdict);
        }
        if (attestation.destinationChainId != block.chainid) {
            revert DestinationChainMismatch(block.chainid, attestation.destinationChainId);
        }
        if (attestation.issuedAt >= attestation.expiresAt) {
            revert InvalidTimeWindow(attestation.issuedAt, attestation.expiresAt);
        }
        if (block.timestamp < attestation.issuedAt) {
            revert AttestationNotYetValid(attestation.issuedAt, block.timestamp);
        }
        if (block.timestamp >= attestation.expiresAt) {
            revert AttestationExpired(attestation.expiresAt, block.timestamp);
        }
    }

    function _emitActionExecuted(
        ActionAttestation calldata attestation,
        bytes32 digest,
        bytes32 returnDataHash
    ) private {
        emit ActionExecuted(
            digest,
            attestation.target,
            attestation.value,
            attestation.calldataHash,
            returnDataHash,
            attestation.nonce
        );
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)
            )
        );
    }
}
