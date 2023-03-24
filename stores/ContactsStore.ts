import { action, observable } from 'mobx';
import EncryptedStorage from 'react-native-encrypted-storage';

interface ContactInfo {
    LNaddress?: string;
    Onchainaddress?: string;
    NIP05?: string;
    Nostrnpub?: string;
}

export default class ContactsStore {
    @observable Contacts: ContactInfo = {
        LNaddress: '',
        Onchainaddress: '',
        NIP05: '',
        Nostrnpub: ''
    };
}
