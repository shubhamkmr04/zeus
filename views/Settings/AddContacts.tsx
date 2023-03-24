import * as React from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Header, Icon, Divider } from 'react-native-elements';

import Scan from '../../assets/images/SVG/Scan.svg';
import Temp from '../../assets/images/SVG/Lock.svg';
import AddIcon from '../../assets/images/SVG/Add.svg';
import { themeColor } from '../../utils/ThemeUtils';
import Button from '../../components/Button';
import TextInput from '../../components/TextInput';

interface AddContactsProps {
    navigation: any;
}

export default class AddContacts extends React.Component<AddContactsProps> {
    render() {
        const { navigation } = this.props;
        const BackButton = () => (
            <Icon
                name="arrow-back"
                onPress={() => {
                    navigation.navigate('ContactsSettings', {
                        refresh: true
                    });
                }}
                color={themeColor('text')}
                underlayColor="transparent"
            />
        );
        const ScanBadge = ({ navigation }: { navigation: any }) => (
            <TouchableOpacity onPress={() => navigation.navigate('')}>
                <Scan fill={themeColor('text')} />
            </TouchableOpacity>
        );
        const AddPhotos = () => (
            <TouchableOpacity>
                <AddIcon
                    fill={themeColor('background')}
                    width="20"
                    height="20"
                    style={{ alignSelf: 'center' }}
                />
            </TouchableOpacity>
        );
        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: themeColor('background')
                }}
            >
                <Header
                    leftComponent={<BackButton />}
                    backgroundColor={themeColor('background')}
                    containerStyle={{
                        borderBottomWidth: 0
                    }}
                    rightComponent={
                        <View style={{ marginTop: 1 }}>
                            <ScanBadge navigation={navigation} />
                        </View>
                    }
                />
                <View
                    style={{ justifyContent: 'center', alignItems: 'center' }}
                >
                    <View
                        style={{
                            backgroundColor: 'white',
                            marginTop: 40,
                            width: 136,
                            height: 136,
                            borderRadius: 68,
                            justifyContent: 'center'
                        }}
                    >
                        <AddPhotos />
                    </View>
                </View>
                <View style={{ alignSelf: 'center', marginTop: 22 }}>
                    <Text style={{ fontSize: 30 }}>Name*</Text>
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 14 }} />
                <View style={{ alignSelf: 'center', marginTop: 14 }}>
                    <Text style={{ fontSize: 18 }}>Description (max 120)</Text>
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 16 }} />
                <View style={styles.inputContainer}>
                    <View>
                        <Temp stroke={themeColor('text')} />
                    </View>
                    <TextInput
                        placeholder="LN address"
                        style={styles.inputField}
                    />
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 10 }} />
                <View style={styles.inputContainer}>
                    <View>
                        <Temp stroke={themeColor('text')} />
                    </View>
                    <TextInput
                        placeholder="Onchain address"
                        numberOfLines={1}
                        style={styles.inputField}
                    />
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 10 }} />
                <View style={styles.inputContainer}>
                    <View>
                        <Temp stroke={themeColor('text')} />
                    </View>
                    <TextInput placeholder="NIP 05" style={styles.inputField} />
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 10 }} />
                <View style={styles.inputContainer}>
                    <View>
                        <Temp stroke={themeColor('text')} />
                    </View>
                    <TextInput
                        placeholder="Nostr npub"
                        style={styles.inputField}
                    />
                </View>
                <Divider orientation="horizontal" style={{ marginTop: 10 }} />
                <View style={{ top: 130 }}>
                    <Button
                        title="Save Contact"
                        buttonStyle={{ padding: 14 }}
                    />
                </View>
            </View>
        );
    }
}

const styles = StyleSheet.create({
    inputContainer: {
        marginTop: 4,
        marginLeft: 14,
        flexDirection: 'row',
        alignItems: 'center'
    },
    inputField: {
        marginLeft: 8
    }
});
