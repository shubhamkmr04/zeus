import { Alert, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import RNRestart from 'react-native-restart';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { localeString } from './LocaleUtils';
import { stopLnd } from './LndMobileUtils';
import BackendUtils from './BackendUtils';
import { signMessageNodePubkey } from '../lndmobile/wallet';
import Base64Utils from './Base64Utils';
import { sleep } from './SleepUtils';
import { zipFolder, unzipFile, encryptFile, decryptFile } from './ZipUtils';

import { BACKUPS_HOST } from '../stores/ChannelBackupStore';

import type SettingsStore from '../stores/SettingsStore';
import type NodeInfoStore from '../stores/NodeInfoStore';
import type SyncStore from '../stores/SyncStore';

import Storage from '../storage';

export const CHANNEL_MIGRATION_ACTIVE = 'channel_migration_active';

const VALID_CHANNEL_DB_EXTENSIONS = ['.zip'];

interface StartChannelExportParams {
    SettingsStore: SettingsStore;
    NodeInfoStore: NodeInfoStore;
    SyncStore: SyncStore;
    setStatus: (msg: string | null) => void;
}

const getGraphDir = (lndDir: string, isTestnet: boolean): string => {
    const network = isTestnet ? 'testnet' : 'mainnet';
    const rootPath = Platform.select({
        android: RNFS.DocumentDirectoryPath,
        ios: `${RNFS.LibraryDirectoryPath}/Application Support`
    });
    return `${rootPath}/${lndDir}/data/graph/${network}`;
};

const restartAlert = (title: string, message?: string) =>
    Alert.alert(
        title,
        message,
        [
            {
                text: localeString('views.Wallet.restart'),
                onPress: () => RNRestart.Restart()
            }
        ],
        { cancelable: false }
    );

/**
 * Requests an authentication challenge from Olympus. The caller signs the
 * returned verification message — the upload flow signs through the active
 * backend, while the restore flow signs against the node pubkey directly,
 * as it runs before the backend is available.
 */
const fetchAuthChallenge = async (pubkey: string): Promise<string> => {
    const response = await ReactNativeBlobUtil.fetch(
        'POST',
        `${BACKUPS_HOST}/api/auth`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ pubkey })
    );

    if (response.info().status !== 200) {
        throw new Error('Authentication failed');
    }

    const json = response.json();
    if (!json.success || !json.verification)
        throw new Error('Invalid auth response');

    return json.verification;
};

const stopLndSafely = async (): Promise<void> => {
    try {
        await stopLnd();
        await sleep(5000);
    } catch (e: any) {
        if (e?.message?.includes?.('closed')) return;
        throw e;
    }
};

const resolveToLocalPath = async (uri: string): Promise<string> => {
    const ext = uri.toLowerCase().endsWith('.db') ? '.db' : '.zip';
    const tempPath = `${RNFS.CachesDirectoryPath}/zeus-import-temp${ext}`;

    if (Platform.OS === 'android' && uri.startsWith('content://')) {
        await RNFS.copyFile(uri, tempPath);
        return tempPath;
    }

    if (Platform.OS === 'ios') {
        let filePath = uri;
        if (filePath.startsWith('file://')) {
            filePath = decodeURIComponent(filePath.replace('file://', ''));
        }
        if (await RNFS.exists(filePath)) {
            if (await RNFS.exists(tempPath)) {
                await RNFS.unlink(tempPath);
            }
            await RNFS.copyFile(filePath, tempPath);
            return tempPath;
        }

        if (await RNFS.exists(tempPath)) {
            return tempPath;
        }

        return filePath;
    }

    return uri;
};

/**
 * Validates a channel backup file before import
 * Checks extension, file existence, and non-empty size
 */
export const validateChannelBackupFile = async (
    fileUri: string,
    fileName: string
): Promise<{ valid: boolean; error?: string }> => {
    const lowerFileName = fileName.toLowerCase();
    const hasValidExtension = VALID_CHANNEL_DB_EXTENSIONS.some((ext) =>
        lowerFileName.endsWith(ext)
    );

    if (!hasValidExtension) {
        return {
            valid: false,
            error: localeString('views.Tools.migration.import.invalidExtension')
        };
    }

    try {
        const localPath = await resolveToLocalPath(fileUri);
        const stat = await RNFS.stat(localPath);
        if (!stat.size || stat.size === 0) {
            return {
                valid: false,
                error: localeString('views.Tools.migration.import.emptyFile')
            };
        }
    } catch (e) {
        return {
            valid: false,
            error: localeString('views.Tools.migration.import.fileNotFound')
        };
    }

    return { valid: true };
};

/**
 * Uploads the graph data to Olympus
 */
export const uploadChannelBackupToOlympus = async (
    lndDir: string,
    isTestnet: boolean,
    pubkey: string,
    seedArray: string,
    setStatus: (message: string | null) => void = () => {}
) => {
    try {
        setStatus(localeString('views.Tools.migration.export.authenticating'));

        const graphDir = getGraphDir(lndDir, isTestnet);

        if (!(await RNFS.exists(graphDir))) {
            Alert.alert(
                localeString('general.error'),
                localeString('views.Tools.migration.export.dbNotFound')
            );
            setStatus(null);
            return;
        }

        // 1. Authentication for status to check for existing backup
        console.log('Authenticating for status check...');
        const statusVerification = await fetchAuthChallenge(pubkey);

        console.log('Signing status challenge...');
        const statusSignData = await BackendUtils.signMessage(
            statusVerification
        );
        const statusSignature =
            statusSignData.zbase || statusSignData.signature;

        setStatus(localeString('views.Tools.migration.export.checkingStatus'));
        console.log('Checking backup status...');
        const statusResponse = await ReactNativeBlobUtil.fetch(
            'POST',
            `${BACKUPS_HOST}/api/status`,
            { 'Content-Type': 'application/json' },
            JSON.stringify({
                pubkey,
                signature: statusSignature,
                message: statusVerification
            })
        );

        if (statusResponse.info().status !== 200) {
            throw new Error('Status check failed');
        }

        const statusJson = statusResponse.json();
        if (!statusJson.success)
            throw new Error(statusJson.error || 'Status check failed');

        const last_backup_at = statusJson.last_backup_at;

        const proceedToUpload = async () => {
            try {
                setStatus(
                    localeString('views.Tools.migration.export.authenticating')
                );
                console.log('Authenticating for uploading backup...');
                const uploadVerification = await fetchAuthChallenge(pubkey);

                console.log('Signing upload challenge...');
                const uploadSignData = await BackendUtils.signMessage(
                    uploadVerification
                );
                const uploadSignature =
                    uploadSignData.zbase || uploadSignData.signature;

                setStatus(
                    localeString('views.Tools.migration.export.stoppingLnd')
                );
                try {
                    await stopLndSafely();
                } catch (e: any) {
                    console.error('Failed to stop LND:', e.message);
                    setStatus(null);
                    Alert.alert(
                        localeString('general.error'),
                        localeString(
                            'views.Tools.migration.export.failedToStopLnd'
                        )
                    );
                    return;
                }

                setStatus(
                    localeString('views.Tools.migration.export.zippingBackup')
                );
                const timestamp = Date.now();
                const tempZipPath = `${RNFS.CachesDirectoryPath}/zeus-olympus-backup-${timestamp}.zip`;
                const tempEncPath = `${RNFS.CachesDirectoryPath}/zeus-olympus-backup-${timestamp}.enc`;
                await zipFolder(graphDir, tempZipPath);

                setStatus(
                    localeString('views.Tools.migration.export.encrypting')
                );
                await encryptFile(tempZipPath, tempEncPath, seedArray);
                await RNFS.unlink(tempZipPath);

                const encryptedBase64 = await ReactNativeBlobUtil.fs.readFile(
                    tempEncPath,
                    'base64'
                );
                await RNFS.unlink(tempEncPath);

                // upload to the server
                setStatus(
                    localeString('views.Tools.migration.export.uploading')
                );
                console.log('Uploading encrypted backup...');
                const backupResponse = await ReactNativeBlobUtil.fetch(
                    'POST',
                    `${BACKUPS_HOST}/api/channels-backup`,
                    { 'Content-Type': 'application/json' },
                    JSON.stringify({
                        pubkey,
                        message: uploadVerification,
                        signature: uploadSignature,
                        backup: encryptedBase64
                    })
                );

                const status = backupResponse.info().status;
                if (status === 413) {
                    throw new Error('Backup too large for server');
                }

                let json;
                try {
                    json = backupResponse.json();
                } catch (e) {
                    throw new Error(
                        `Server returned non-JSON response (HTTP ${status})`
                    );
                }
                console.log('Upload response:', json);

                setStatus(null);

                if (status === 200 && json.success) {
                    await Storage.setItem(
                        CHANNEL_MIGRATION_ACTIVE,
                        JSON.stringify({ migrationStatus: true, lndDir })
                    );

                    restartAlert(
                        localeString('views.Tools.migration.export.success'),
                        localeString(
                            'views.Tools.migration.export.success.text'
                        )
                    );
                } else {
                    restartAlert(
                        localeString('general.error'),
                        json.error ||
                            localeString(
                                'views.Tools.migration.export.failedToUpload'
                            )
                    );
                }
            } catch (e) {
                console.error('Upload failed:', e);
                setStatus(null);
                restartAlert(
                    localeString('general.error'),
                    localeString('views.Tools.migration.export.failedToUpload')
                );
            }
        };

        if (last_backup_at) {
            const dateStr = new Date(last_backup_at).toLocaleString();

            Alert.alert(
                localeString(
                    'views.Tools.migration.export.existingBackupFound'
                ),
                localeString('views.Tools.migration.export.replaceBackup', {
                    date: dateStr
                }),
                [
                    {
                        text: localeString('general.cancel'),
                        style: 'cancel',
                        onPress: () => {
                            setStatus(null);
                        }
                    },
                    {
                        text: localeString(
                            'views.Tools.migration.export.replace'
                        ),
                        style: 'destructive',
                        onPress: proceedToUpload
                    }
                ]
            );
        } else {
            await proceedToUpload();
        }
    } catch (error) {
        console.error(error);
        setStatus(null);
        Alert.alert(
            localeString('general.error'),
            localeString('views.Tools.migration.export.failedToUpload')
        );
    }
};

/**
 * Downloads and restores the graph data from Olympus
 */
export const restoreChannelBackupFromOlympus = async (
    lndDir: string,
    isTestnet: boolean,
    pubkey: string,
    seedArray: string
): Promise<boolean> => {
    try {
        // 1. Authentication for status to check for existing backup
        console.log('Authenticating for status check...');
        const statusVerification = await fetchAuthChallenge(pubkey);

        console.log('Signing status challenge...');
        const statusSignData = await signMessageNodePubkey(
            Base64Utils.stringToUint8Array(statusVerification)
        );
        const statusSignature = statusSignData.signature;

        console.log('Checking backup status...');
        const statusResponse = await ReactNativeBlobUtil.fetch(
            'POST',
            `${BACKUPS_HOST}/api/status`,
            { 'Content-Type': 'application/json' },
            JSON.stringify({
                pubkey,
                signature: statusSignature,
                message: statusVerification
            })
        );

        if (statusResponse.info().status !== 200) {
            throw new Error('Status check failed');
        }

        const statusJson = statusResponse.json();
        if (!statusJson.success)
            throw new Error(statusJson.error || 'Status check failed');

        const last_backup_at = statusJson.last_backup_at;

        if (!last_backup_at) {
            await new Promise<void>((resolve) => {
                Alert.alert(
                    localeString('general.error'),
                    localeString(
                        'views.Tools.migration.import.noBackupFoundOlympus'
                    ),
                    [
                        {
                            text: localeString(
                                'views.Tools.migration.import.noBackup'
                            ),
                            onPress: () => resolve()
                        }
                    ],
                    { cancelable: false }
                );
            });
            return false;
        }

        const userConfirmed = await new Promise<boolean>((resolve) => {
            const dateStr = new Date(last_backup_at).toLocaleString();
            Alert.alert(
                localeString('views.Tools.migration.export.backupFound'),
                localeString(
                    'views.Tools.migration.import.backupFoundMessage',
                    { date: dateStr }
                ),
                [
                    {
                        text: localeString('general.cancel'),
                        style: 'cancel',
                        onPress: () => resolve(false)
                    },
                    {
                        text: localeString(
                            'views.Settings.EmbeddedNode.restoreChannelBackups.restore'
                        ),
                        onPress: () => resolve(true)
                    }
                ],
                { cancelable: false }
            );
        });

        if (!userConfirmed) {
            return false;
        }

        // 2. Authenticatication for restoring backup
        console.log('Authenticating for restore...');
        const restoreVerification = await fetchAuthChallenge(pubkey);

        console.log('Signing restore challenge...');
        const restoreSignData = await signMessageNodePubkey(
            Base64Utils.stringToUint8Array(restoreVerification)
        );
        const restoreSignature = restoreSignData.signature;

        // 3. Download the encrypted backup
        console.log('Downloading encrypted backup...');
        const timestamp = Date.now();
        const tempEncPath = `${RNFS.CachesDirectoryPath}/zeus-olympus-restore-${timestamp}.enc`;
        const tempZipPath = `${RNFS.CachesDirectoryPath}/zeus-olympus-restore-${timestamp}.zip`;

        const restoreResponse = await ReactNativeBlobUtil.fetch(
            'POST',
            `${BACKUPS_HOST}/api/restore-channels`,
            { 'Content-Type': 'application/json' },
            JSON.stringify({
                pubkey,
                message: restoreVerification,
                signature: restoreSignature
            })
        );

        const restoreStatus = restoreResponse.info().status;
        if (restoreStatus !== 200) {
            let errorMsg = 'Download failed';
            try {
                const errorJson = restoreResponse.json();
                if (errorJson.error) errorMsg = errorJson.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        // The server stores and returns the backup as a base64 string
        // (it was uploaded as base64 inside a JSON body). Decode it
        // back to raw binary before decrypting.
        const encryptedBase64Response = await restoreResponse.text();
        await ReactNativeBlobUtil.fs.writeFile(
            tempEncPath,
            encryptedBase64Response,
            'base64'
        );

        // 4. Decrypt the payload
        console.log('Decrypting backup...');
        await decryptFile(tempEncPath, tempZipPath, seedArray);
        await RNFS.unlink(tempEncPath);

        const MAX_RECOVERY_WAIT_ATTEMPTS = 60;
        for (let attempt = 1; ; attempt++) {
            try {
                await stopLnd();
                await sleep(5000);
                break;
            } catch (e: any) {
                if (e?.message?.includes?.('closed')) break;
                if (e?.message?.includes?.('wallet recovery in progress')) {
                    if (attempt >= MAX_RECOVERY_WAIT_ATTEMPTS) {
                        throw new Error(
                            localeString(
                                'views.Tools.migration.export.failedToStopLnd'
                            )
                        );
                    }
                    console.log(
                        `Wallet recovery in progress, waiting 5s (attempt ${attempt}/${MAX_RECOVERY_WAIT_ATTEMPTS})...`
                    );
                    await sleep(5000);
                    continue;
                }
                throw new Error(
                    localeString('views.Tools.migration.export.failedToStopLnd')
                );
            }
        }

        const destFolder = getGraphDir(lndDir, isTestnet);

        if (!(await RNFS.exists(destFolder))) {
            await RNFS.mkdir(destFolder);
        }

        try {
            const existing = await RNFS.readDir(destFolder);
            for (const item of existing) {
                if (item.isFile()) await RNFS.unlink(item.path);
            }
        } catch (e) {}

        await unzipFile(tempZipPath, destFolder);
        await RNFS.unlink(tempZipPath);

        return true;
    } catch (error: any) {
        console.error('Restore Flow Failed', error);
        throw error;
    }
};

/**
 * Exports the graph data as a .zip file
 * On Android, saves directly to Downloads; on iOS, opens share sheet
 */
export const exportChannelDb = async (
    lndDir: string,
    isTestnet: boolean,
    setStatus: (message: string | null) => void = () => {}
) => {
    try {
        const graphDir = getGraphDir(lndDir, isTestnet);

        if (!(await RNFS.exists(graphDir))) {
            Alert.alert(
                localeString('general.error'),
                localeString('views.Tools.migration.databaseNotFound')
            );
            setStatus(null);
            return;
        }

        setStatus(localeString('views.Tools.migration.export.stoppingLnd'));
        try {
            await stopLndSafely();
        } catch (e: any) {
            console.error('Failed to stop LND:', e.message);
            setStatus(null);
            Alert.alert(
                localeString('general.error'),
                localeString('views.Tools.migration.export.failedToStopLnd')
            );
            return;
        }

        const network = isTestnet ? 'testnet' : 'mainnet';
        const backupFileName = `zeus-lnd-${network}-${Date.now()}.zip`;

        const stagingDir =
            Platform.OS === 'android'
                ? RNFS.CachesDirectoryPath
                : RNFS.DocumentDirectoryPath;
        const stagingPath = `${stagingDir}/${backupFileName}`;

        if (await RNFS.exists(stagingPath)) {
            await RNFS.unlink(stagingPath);
        }

        setStatus(localeString('views.Tools.migration.export.zippingBackup'));
        await zipFolder(graphDir, stagingPath);

        setStatus(localeString('views.Tools.migration.export.savingFile'));

        const finishExport = async () => {
            setStatus(null);
            await Storage.setItem(
                CHANNEL_MIGRATION_ACTIVE,
                JSON.stringify({ migrationStatus: true, lndDir })
            );
            restartAlert(
                localeString('views.Tools.migration.export.success'),
                localeString(
                    Platform.OS === 'android'
                        ? 'views.Tools.migration.export.success.text.android'
                        : 'views.Tools.migration.export.success.text'
                )
            );
        };

        if (Platform.OS === 'android') {
            const downloadPath = `${RNFS.DownloadDirectoryPath}/${backupFileName}`;
            await RNFS.copyFile(stagingPath, downloadPath);
            await RNFS.unlink(stagingPath);
            await finishExport();
            return;
        }

        try {
            const shareResult = await Share.open({
                title: localeString('views.Tools.migration.export.title'),
                url: `file://${stagingPath}`,
                type: 'application/octet-stream',
                filename: backupFileName,
                failOnCancel: false
            });

            const isDismissed =
                shareResult.dismissedAction || shareResult.success === false;

            if (isDismissed) {
                await RNFS.unlink(stagingPath);
                restartAlert(
                    localeString('views.Tools.migration.export.cancelled'),
                    localeString('views.Tools.migration.export.cancelled.text')
                );
                return;
            }

            await RNFS.unlink(stagingPath);
            await finishExport();
        } catch (err: any) {
            if (await RNFS.exists(stagingPath)) {
                await RNFS.unlink(stagingPath);
            }

            const errorMsg = err?.message || String(err);
            if (
                errorMsg.includes('User did not share') ||
                errorMsg.includes('cancel')
            ) {
                restartAlert(
                    localeString('views.Tools.migration.export.cancelled'),
                    localeString('views.Tools.migration.export.cancelled.text')
                );
                return;
            }

            throw err;
        }
    } catch (error) {
        console.error('Export Failed:', error);
        setStatus(null);
        restartAlert(localeString('general.error'));
    }
};

/**
 * Prompts the user to export channel backup — either to Olympus (SQLite only)
 * or as a local zip file.
 */
export const handleExportChannels = ({
    isSqlite,
    lndDir,
    isTestnet,
    pubkey,
    seedPhrase,
    setStatus
}: {
    isSqlite: boolean;
    lndDir: string;
    isTestnet: boolean;
    pubkey: string;
    seedPhrase: string;
    setStatus: (msg: string | null) => void;
}) => {
    const warningText =
        `${localeString('views.Tools.migration.export.text1')}\n\n` +
        `⚠️ ${localeString('views.Tools.migration.export.text2')}`;

    if (isSqlite) {
        Alert.alert(
            localeString('views.Tools.migration.export.title'),
            warningText,
            [
                {
                    text: localeString('general.cancel'),
                    style: 'cancel'
                },
                {
                    text: localeString('views.Tools.migration.export.olympus'),
                    style: 'default',
                    onPress: async () => {
                        await uploadChannelBackupToOlympus(
                            lndDir,
                            isTestnet,
                            pubkey,
                            seedPhrase,
                            setStatus
                        );
                    }
                },
                {
                    text: localeString('views.Tools.migration.export.local'),
                    style: 'default',
                    onPress: async () => {
                        await exportChannelDb(lndDir, isTestnet, setStatus);
                    }
                }
            ]
        );
    } else {
        Alert.alert(
            localeString('views.Tools.migration.export.title'),
            warningText,
            [
                {
                    text: localeString('general.cancel'),
                    style: 'cancel'
                },
                {
                    text: localeString('general.ok'),
                    style: 'default',
                    onPress: async () => {
                        await exportChannelDb(lndDir, isTestnet, setStatus);
                    }
                }
            ]
        );
    }
};

/**
 * Entry point for the channel export flow, shared by the Tools and Seed views.
 * Blocks while the node is still syncing, then resolves the export parameters
 * from the active node's stores.
 */
export const startChannelExport = ({
    SettingsStore,
    NodeInfoStore,
    SyncStore,
    setStatus
}: StartChannelExportParams) => {
    if (SyncStore.isSyncing) {
        Alert.alert(
            localeString('general.error'),
            localeString('views.Tools.migration.export.syncInProgress')
        );
        return;
    }

    handleExportChannels({
        isSqlite: SettingsStore.isSqlite ?? true,
        lndDir: SettingsStore.lndDir || 'lnd',
        isTestnet: NodeInfoStore.nodeInfo.isTestNet,
        pubkey: NodeInfoStore.nodeInfo.identity_pubkey,
        seedPhrase: SettingsStore.seedPhrase.join(' '),
        setStatus
    });
};

/**
 * Imports a channel backup zip file (works for both SQLite and bolt DB).
 * Clears existing files in the graph directory and unzips the backup.
 */
export const importChannelDb = async (
    sourceUri: string,
    fileName: string,
    lndDir: string,
    isTestnet: boolean
) => {
    const validation = await validateChannelBackupFile(sourceUri, fileName);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const localPath = await resolveToLocalPath(sourceUri);
    const destFolder = getGraphDir(lndDir, isTestnet);

    if (!(await RNFS.exists(destFolder))) {
        await RNFS.mkdir(destFolder);
    }

    try {
        const existing = await RNFS.readDir(destFolder);
        for (const item of existing) {
            if (item.isFile()) {
                await RNFS.unlink(item.path);
            }
        }
    } catch (e) {}

    await unzipFile(localPath, destFolder);
};
